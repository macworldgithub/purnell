import { mkdir, open, readFile, unlink, appendFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join,relative,isAbsolute } from 'node:path';
import dotenv from 'dotenv';
import { refreshScope } from './refresh-erapower-scope.mjs';
import { createScriptRunner,loadJson,saveJson } from './erapower-sync-runtime.mjs';
import { validatedReports } from './erapower-report-validation.mjs';
import { parseCsv } from './pentana-export/csv.mjs';
import { createHash } from 'node:crypto';

const project=fileURLToPath(new URL('../',import.meta.url));
const exporter=join(project,'tools','pentana-export');
const exportsRoot=join(exporter,'exports');
const logs=join(project,'logs','erapower-sync');
await mkdir(logs,{recursive:true});
const lockPath=join(logs,'running.lock');
let lock;
try{lock=await open(lockPath,'wx');}
catch(error){
  if(error.code!=='EEXIST')throw error;
  const owner=Number(await readFile(lockPath,'utf8'));
  if(!Number.isSafeInteger(owner)||owner<=0)throw Error('Invalid scheduler lock requires inspection');
  try{process.kill(owner,0);console.log('Another sync owns the browser; trigger skipped.');process.exit(0);}
  catch(check){if(check.code!=='ESRCH')throw check;}
  await unlink(lockPath);lock=await open(lockPath,'wx');
}
await lock.writeFile(String(process.pid));
const invocationId=new Date().toISOString().replace(/[:.]/g,'-');
const invocationStartedAt=new Date().toISOString();
const pointerPath=join(logs,'active-cycle.json');
let cycle,stage='configuration',output,lastActivityAt=invocationStartedAt;
const totals=new Map();
const history=entry=>appendFile(join(logs,'history.ndjson'),JSON.stringify({invocationId,runId:cycle?.runId,at:new Date().toISOString(),...entry})+'\n');
async function progress(name){
  stage=name;
  await saveJson(join(logs,'progress.json'),{runId:cycle.runId,invocationId,startedAt:invocationStartedAt,cycleStartedAt:cycle.startedAt,stage,output,updatedAt:new Date().toISOString(),lastActivityAt});
  console.log('eraPower stage: '+name);
}
let heartbeat;
try{
  const config=dotenv.parse(await readFile(join(project,'.env.erapower-sync')));
  if(!config.PURNELL_COPY_TARGET_URI)throw Error('Sync MongoDB configuration missing');
  const env={...process.env,...config};
  const pending=await loadJson(pointerPath);
  cycle=pending?.status==='pending'?pending:{runId:invocationId,startedAt:invocationStartedAt,output:join(exportsRoot,'scheduled-'+invocationId),status:'pending'};
  const suffix=relative(exportsRoot,cycle.output);
  if(suffix.startsWith('..')||isAbsolute(suffix))throw Error('Resume folder is outside the export workspace');
  output=cycle.output;
  await mkdir(output,{recursive:true});await saveJson(pointerPath,cycle);
  const budgetMinutes=Number(config.ERAPOWER_SYNC_BUDGET_MINUTES||150);
  if(!Number.isFinite(budgetMinutes)||budgetMinutes<1||budgetMinutes>155)throw Error('Sync budget must be 1–155 minutes');
  const run=createScriptRunner({logPath:join(logs,invocationId+'.log'),deadline:Date.now()+budgetMinutes*60000,onActivity:()=>{lastActivityAt=new Date().toISOString();}});
  heartbeat=setInterval(()=>progress(stage).catch(()=>{}),30000);
  await history({event:'started',output,resumed:cycle.runId!==invocationId});
  await progress('eraPower session and sign-in');await run('ensure-session.mjs',[],exporter,env);
  async function publishFolder(folder){
    await progress('Publishing validated records to MongoDB');
    await run(join(project,'tools','seed-erapower-current.mjs'),['--input='+folder],project,env);
    const published=await loadJson(join(folder,'mongodb-current-result.json'));
    for(const item of published.datasets){
      const prior=totals.get(item.collection);
      totals.set(item.collection,{...item,new_rows:(prior?.new_rows||0)+item.new_rows,updated_rows:(prior?.updated_rows||0)+item.updated_rows});
    }
    await saveJson(join(logs,'published-progress.json'),{runId:cycle.runId,invocationId,updatedAt:new Date().toISOString(),datasets:[...totals.values()]});
    await history({event:'published',folder,datasets:published.datasets});
  }
  // Small live reports refresh at every trigger; deep records resume independently.
  const poll=join(exportsRoot,'poll-'+invocationId);await mkdir(poll,{recursive:true});
  await progress('Refreshing live repair and appointment reports');
  let reportError;
  let checked;
  for(let attempt=0;attempt<2;attempt++){
    try{await run('export-pentana.mjs',['--only','open_repair_orders,appointments,status_codes','--from','01/01/2025','--to','31/12/'+(new Date().getFullYear()+1),'--out',poll],exporter,env);}
    catch(error){reportError=error;}
    checked=await validatedReports(poll).catch(()=>({valid:[],complete:false,errors:[]}));
    if(checked.complete||reportError?.code==='ERAPOWER_BUDGET')break;
  }
  if(checked.valid.length){
    const datasets=[];
    for(const item of checked.valid){const bytes=await readFile(join(poll,item.file));datasets.push({name:item.name,file:item.file,rows:parseCsv(bytes.toString('utf8')).rows.length,sha256:createHash('sha256').update(bytes).digest('hex'),complete:true});}
    await saveJson(join(poll,'full-sync-manifest.json'),{runId:invocationId,startedAt:invocationStartedAt,datasets,limitations:[],failures:[]});
    await publishFolder(poll);
    const knownFile=join(exporter,'.local','sync-known-records.json');
    const known=await loadJson(knownFile,{customers:[],vehicles:[]});
    const customers=new Set(known.customers),vehicles=new Set(known.vehicles);
    for(const item of checked.valid){
      const rows=parseCsv(await readFile(join(poll,item.file),'utf8')).records;
      if(item.name==='open_repair_orders')for(const row of rows)if(row['customer id'])customers.add(row['customer id'].trim());
      if(item.name==='appointments')for(const row of rows){if(row.custno)customers.add(row.custno.trim());if(row['serial no'])vehicles.add(row['serial no'].trim());}
    }
    await mkdir(join(exporter,'.local'),{recursive:true});
    await saveJson(knownFile,{customers:[...customers],vehicles:[...vehicles]});
    if(cycle.runId===invocationId&&checked.complete){
      for(const item of checked.valid)await copyFile(join(poll,item.file),join(output,item.file));
      await copyFile(join(poll,'manifest.json'),join(output,'manifest.json'));
    }
  }
  if(!checked.complete)await history({event:'live_reports_partial',error:reportError?.message||'Some reports did not validate'});
  let manifest,paused=false;
  try{manifest=await refreshScope({output,exporter,run,env,progress,runId:cycle.runId,startedAt:cycle.startedAt,publish:()=>publishFolder(output)});}
  catch(error){if(error.code!=='ERAPOWER_BUDGET')throw error;paused=true;manifest=await loadJson(join(output,'full-sync-manifest.json'));}
  manifest.failures=manifest.failures.filter(item=>!['Final verification','Live reports'].includes(item.stage));
  if(!checked.complete)manifest.failures.push({stage:'Live reports',error:'Some live reports did not validate; see the invocation log and poll manifest'});
  await saveJson(join(output,'full-sync-manifest.json'),manifest);
  if(!paused){
    await publishFolder(output);
    await progress('Verifying CSV coverage and MongoDB contents');
    try{await run(join(project,'tools','verify-erapower-refresh.mjs'),['--input='+output],project,env);}
    catch{manifest.failures.push({stage:'Final verification',error:'See verification.json for unexplained missing records or database differences'});}
  }
  const verification=await loadJson(join(output,'verification.json'));
  const complete=!paused&&manifest.failures.length===0;
  cycle.status=complete?'complete':'pending';await saveJson(pointerPath,cycle);
  manifest.invocationId=invocationId;manifest.status=paused?'resumable':complete?'completed_with_source_limits':'retry_pending';
  await saveJson(join(output,'full-sync-manifest.json'),manifest);
  const status={runId:cycle.runId,invocationId,startedAt:invocationStartedAt,cycleStartedAt:cycle.startedAt,completedAt:new Date().toISOString(),success:complete,partial:!complete||!!verification?.sourceLimited,status:manifest.status,resumable:!complete,stage:paused?'Checkpoint saved; continuing at next trigger':manifest.failures.map(x=>x.stage).join(', '),failures:manifest.failures,limitations:manifest.limitations,output,result:{datasets:[...totals.values()]}};
  await saveJson(join(logs,'latest.json'),status);await history({event:manifest.status,...status});
  if(!complete&&!paused)process.exitCode=2;
}catch(error){
  const status={runId:cycle?.runId||invocationId,invocationId,startedAt:invocationStartedAt,completedAt:new Date().toISOString(),success:false,resumable:!!cycle,status:'retry_pending',stage,message:error.message,output,result:{datasets:[...totals.values()]}};
  await saveJson(join(logs,'latest.json'),status);await history({event:'failed',...status});
  console.error('eraPower sync paused after an error; see latest.json and the streaming log.');process.exitCode=1;
}finally{
  clearInterval(heartbeat);await lock.close();await unlink(lockPath).catch(()=>{});
}
