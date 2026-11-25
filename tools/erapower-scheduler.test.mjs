import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadedReportPage} from './pentana-export/report-pagination.mjs';
import {atomicWriteFile} from './pentana-export/atomic-file.mjs';
import {validatedReports,reportNames} from './erapower-report-validation.mjs';
import {createScriptRunner} from './erapower-sync-runtime.mjs';
import {refreshScope} from './refresh-erapower-scope.mjs';

test('Pagination waits for populated rows and accepts the final partial page',()=>{
  const ids=Array.from({length:12},(_,i)=>String(i+1));
  assert.equal(loadedReportPage('Row 1 of 145 Page 1 of 13',['1',...Array(11).fill('')]),null);
  assert.equal(loadedReportPage('Row 1 of 145 Page 1 of 13',ids).values.length,12);
  assert.equal(loadedReportPage('Row 145 of 145 Page 13 of 13',['145',...Array(11).fill('')]).values.length,1);
  assert.equal(loadedReportPage('Row 1 of 2 Page 1 of 1',['1','2',...Array(10).fill('')]).values.length,2);
});

test('Validated CSVs survive navigation cleanup failures; corrupt or missing reports fail validation',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'erapower-validation-'));
  try{
    const csv='id\n001\n';
    const datasets=reportNames.map(name=>({name,file:name+'.csv',status:'exported',rows:1,sha256:createHash('sha256').update(csv).digest('hex')}));
    for(const item of datasets)await writeFile(join(folder,item.file),csv);
    await writeFile(join(folder,'manifest.json'),JSON.stringify({datasets,cleanup_warning:'Exit navigation timed out'}));
    assert.equal((await validatedReports(folder)).complete,true);
    await writeFile(join(folder,datasets[0].file),'id\n002\n');
    assert.equal((await validatedReports(folder)).valid.length,4);
    await rm(join(folder,datasets[1].file));
    assert.equal((await validatedReports(folder)).errors.length,2);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('Checkpoint readers always see complete JSON during replacement',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'erapower-atomic-'));
  const file=join(folder,'checkpoint.json');
  try{
    await atomicWriteFile(file,JSON.stringify({count:0,payload:'x'.repeat(10000)}));
    let done=false;
    const reader=(async()=>{while(!done){const value=JSON.parse(await readFile(file,'utf8'));assert.equal(value.payload.length,10000);await new Promise(resolve=>setTimeout(resolve,10));}})();
    try{for(let count=1;count<=30;count++)await atomicWriteFile(file,JSON.stringify({count,payload:'x'.repeat(10000)}));}
    finally{done=true;await reader;}
    assert.equal(JSON.parse(await readFile(file,'utf8')).count,30);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('Resume with a newer checkpoint CSV defers that dataset until its stage validates it',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'erapower-resume-'));
  try{
    const csv='id\n001\n';
    const hash=createHash('sha256').update(csv).digest('hex');
    const reports=reportNames.map(name=>({name,file:name+'.csv',status:'exported',rows:1,sha256:hash}));
    for(const item of reports)await writeFile(join(folder,item.file),csv);
    await writeFile(join(folder,'manifest.json'),JSON.stringify({datasets:reports}));
    await writeFile(join(folder,'repair_job_narratives.csv'),'id\n002\n');
    await writeFile(join(folder,'full-sync-manifest.json'),JSON.stringify({runId:'resume-test',startedAt:new Date().toISOString(),datasets:[...reports,{name:'repair_job_narratives',file:'repair_job_narratives.csv',rows:1,sha256:hash}],failures:[],limitations:[]}));
    const stop=Error('Stop after report publication');
    await assert.rejects(refreshScope({output:folder,exporter:folder,runId:'resume-test',progress:async()=>{},run:async()=>assert.fail('Valid existing reports must be reused'),publish:async()=>{
      const manifest=JSON.parse(await readFile(join(folder,'full-sync-manifest.json'),'utf8'));
      assert.equal(manifest.datasets.length,5);
      assert.equal(manifest.datasets.some(item=>item.name==='repair_job_narratives'),false);
      throw stop;
    }}),error=>error===stop);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('Budget stop flushes streamed logs and waits until the owned worker exits',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'erapower-runtime-'));
  const cwd=join(folder,'pentana-export');await mkdir(cwd);
  try{
    await writeFile(join(cwd,'worker.mjs'),"console.log('WORKER_READY');setInterval(()=>{},1000);");
    const logPath=join(folder,'run.log');
    const run=createScriptRunner({logPath,deadline:Date.now()+1500});
    const result=run('worker.mjs',[],cwd,process.env).then(()=>null,error=>error);
    for(let retry=0;retry<50;retry++){
      const log=await readFile(logPath,'utf8').catch(()=>'');
      if(log.includes('WORKER_READY'))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.match(await readFile(logPath,'utf8'),/WORKER_READY/);
    assert.equal((await result)?.code,'ERAPOWER_BUDGET');
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('An unfinished narrative lookup retries through direct review before declaring failure',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'erapower-review-'));
  try{
    const datasets=[];
    async function csv(name,text){await writeFile(join(folder,name+'.csv'),text);datasets.push({name,file:name+'.csv',status:'exported',rows:text.trim().split('\n').length-1,sha256:createHash('sha256').update(text).digest('hex')});}
    for(const name of reportNames)await csv(name,name==='open_repair_orders'?'ro number,customer id\n001,C01\n':'id\n1\n');
    await writeFile(join(folder,'manifest.json'),JSON.stringify({datasets:[...datasets]}));
    await csv('repair_order_details','ro_number\n001\n');
    await csv('repair_order_jobs','ro_number,job_index,operation_code\n001,1,SERVICE\n');
    await writeFile(join(folder,'repair-report-checkpoint.json'),JSON.stringify({completed_ids:['001']}));
    await writeFile(join(folder,'job-narratives-checkpoint.json'),JSON.stringify({completed_ros:[],records:[]}));
    await writeFile(join(folder,'full-sync-manifest.json'),JSON.stringify({runId:'review-test',datasets,failures:[],limitations:[]}));
    const attempts=[],stop=Error('Stop after narrative publication');
    await assert.rejects(refreshScope({output:folder,exporter:folder,runId:'review-test',progress:async()=>{},run:async(script,args)=>{
      assert.equal(script,'scrape-job-narratives.mjs');attempts.push(args);
      const completed=args.includes('--direct');
      await writeFile(join(folder,'job-narratives-checkpoint.json'),JSON.stringify({completed_ros:completed?['001']:[],records:[]}));
      await writeFile(join(folder,'repair_job_narratives.csv'),'ro_number,job_index,operation_code\n'+(completed?'001,1,SERVICE\n':''));
    },publish:async()=>{
      const m=JSON.parse(await readFile(join(folder,'full-sync-manifest.json'),'utf8'));
      if(m.datasets.some(item=>item.name==='repair_job_narratives')){
        assert.equal(m.failures.length,0);assert.equal(m.datasets.find(item=>item.name==='repair_job_narratives').complete,true);throw stop;
      }
    }}),error=>error===stop);
    assert.equal(attempts.length,2);assert.equal(attempts[1].includes('--direct'),true);
  }finally{await rm(folder,{recursive:true,force:true});}
});
