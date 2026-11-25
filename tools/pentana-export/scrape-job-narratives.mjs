import {readFile} from 'node:fs/promises';
import {atomicWriteFile as writeFile} from './atomic-file.mjs';
import {resolve,join} from 'node:path';
import {connect,serviceMenu,clickText,visibleLocator,until,waitForReportPage,goToTablePage} from './pentana-ui.mjs';
import {parseCsv,toCsv} from './csv.mjs';
import {handleKnownSerialWarning} from './ensure-session.mjs';
const out=resolve(process.argv[2]||'exports/run-2026-10-26');
const refs=parseCsv(await readFile(join(out,'open_repair_orders.csv'),'utf8')).records;
const jobs=parseCsv(await readFile(join(out,'repair_order_jobs.csv'),'utf8')).records;
const ids=new Set(refs.map(r=>r['ro number']));
const file=join(out,'job-narratives-checkpoint.json');
const state=JSON.parse(await readFile(file,'utf8').catch(()=>JSON.stringify({records:[],completed_ros:[],failures:[]})));
delete state.page_size; // Older checkpoints cached a partially rendered first row.
const fields={ro_number:'txtRoNo',operation_description:'txaOpCodeDesc',department:'txtDept',sale_type:'txtSaleType',job_status:'txtJobStatus',complaint:'txaComplaint',cause:'txaCause',correction:'txaCorrection',technician_notes:'txaTechNotes',updated_by:'dspUpdatedBy',updated_date:'dspUpdatedDate',updated_time:'dspUpdatedTime'};
const {browser,page}=await connect();
async function save(){state.updated_at=new Date().toISOString();await writeFile(file,JSON.stringify(state,null,2));await writeFile(join(out,'repair_job_narratives.csv'),toCsv(['job_index','operation_code',...Object.keys(fields),'source','exported_at'],state.records));
 const key=r=>r.ro_number+'|'+r.job_index+'|'+r.operation_code.trim();const found=new Set(state.records.map(key));
 await writeFile(join(out,'repair_narrative_coverage.csv'),toCsv(['ro_number','job_index','operation_code','status'],jobs.map(j=>({ro_number:j.ro_number,job_index:j.job_index,operation_code:j.operation_code,status:found.has(key(j))?'exported':state.completed_ros.includes(j.ro_number)?'not_present_in_current_job_selector':state.unavailable_ros?.includes(j.ro_number)?'not_in_open_report_and_review_lookup_invalid':'not_yet_exported'}))));
}
async function capture(ro){
  if(state.completed_ros.includes(ro))return;
  const n=jobs.filter(j=>j.ro_number===ro).length;
  if(!n){state.completed_ros.push(ro);await save();return;}
  if(!await page.frame({name:'gutsPage'}).locator('#selOpCode').isVisible().catch(()=>false)){
    await page.frame({name:'gutsPage'}).locator('#tblJob input[id="searchresults$1_FldOne"]').first().click();
    await visibleLocator(page,'gutsPage','#selOpCode');
  }
  await until(async()=>await page.frame({name:'gutsPage'}).locator('#selOpCode').evaluate(s=>[...s.options].filter(o=>o.value).length)>0,'Job options loaded');
  const options=await page.frame({name:'gutsPage'}).locator('#selOpCode').evaluate(s=>[...s.options].map((o,index)=>({index,value:o.value,label:o.text})).filter(o=>o.value));
  if(options.length!==n){state.source_changes??=[];state.source_changes.push({ro_number:ro,previous_jobs:n,current_jobs:options.length,observed_at:new Date().toISOString()});}
  const pending=[];
  for(const o of options){
    let select=await visibleLocator(page,'gutsPage','#selOpCode');
    const selected=await select.evaluate(s=>s.selectedIndex);
    if(selected!==o.index){
      await select.click();await select.press('Home');
      for(let index=0;index<o.index;index++)await select.press('ArrowDown');
      await select.press('Enter');await select.press('Tab');
      await until(async()=>await page.frame({name:'gutsPage'}).locator('#selOpCode').evaluate(s=>s.selectedIndex)===o.index,'Job selector ready');
      await page.waitForLoadState('networkidle',{timeout:1500}).catch(()=>{});await page.waitForTimeout(150);
    }
    const r=await page.frame({name:'gutsPage'}).locator('body').evaluate((body,fields)=>Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,body.querySelector(`[id="${id}"]`)?.value??''])),fields);
    if(r.ro_number.trim()!==ro)throw new Error('Job narrative RO mismatch');
    const after=await page.frame({name:'gutsPage'}).locator('#selOpCode').evaluate(s=>s.selectedIndex);
    if(after!==o.index)throw new Error('Job selector changed during capture');
    r.job_index=o.label.match(/^\s*(\d+)/)?.[1]||String(o.index);r.operation_code=o.value;
    const expected=jobs.find(j=>j.ro_number===ro&&j.job_index===r.job_index);
    if(expected&&expected.operation_code.trim()!==o.value.trim()){state.source_changes??=[];state.source_changes.push({ro_number:ro,job_index:r.job_index,previous_operation:expected.operation_code,current_operation:o.value,observed_at:new Date().toISOString()});}
    r.source='RO Review Job Details';r.exported_at=new Date().toISOString();pending.push(r);
  }
  state.records.push(...pending);state.completed_ros.push(ro);await save();console.log(`job narratives: ${state.records.length}/${jobs.length}; ROs: ${state.completed_ros.length}/${refs.length}`);
  // Job Details is a view within RO Review; its Exit returns to the report.
}
async function openReport(){await serviceMenu(page);await clickText(page,'gutsPage','Reports Menu');await clickText(page,'gutsPage','Open RO Report');await visibleLocator(page,'gutsPage','#selDepartment');await page.frame({name:'gutsPage'}).locator('#selDepartment').selectOption({label:'All Departments'});await page.frame({name:'gutsPage'}).locator('#selAdvisor').selectOption({label:'All Advisors'});await clickText(page,'action','Show Report');}
try{
  if(process.argv.includes('--direct')){
    for(const ref of refs.filter(r=>!state.completed_ros.includes(r['ro number'])&&!state.unavailable_ros?.includes(r['ro number']))){
      await serviceMenu(page);await clickText(page,'gutsPage','RO Review');
      const field=await visibleLocator(page,'gutsPage','#txtRoNo');await field.click();await field.press('ControlOrMeta+A');await field.pressSequentially(ref['ro number'],{delay:30});
      await page.frame({name:'gutsPage'}).getByText('RO Review',{exact:true}).click();await page.waitForTimeout(400);await field.focus();await field.press('Enter');
      const result=await until(async()=>{const message=await page.frames().filter(f=>f.name()==='guts').at(-1)?.locator('body').innerText({timeout:300}).catch(()=>'');if(/is not a valid Repair Order/.test(message||''))return 'invalid';if(await page.frame({name:'gutsPage'}).locator('#txtCustNo').inputValue())return 'loaded';return false;},'RO lookup result');
      if(result==='invalid'){await clickText(page,'action','OK');state.unavailable_ros??=[];state.unavailable_ros.push(ref['ro number']);await save();console.log('RO unavailable in current report and direct review lookup; recorded.');continue;}
      await until(async()=>await page.frame({name:'gutsPage'}).locator('#txtCustNo').inputValue()===ref['customer id'],'Direct RO matched customer');
      if((await page.frame({name:'gutsPage'}).locator('#txtRoNo').inputValue()).trim()!==ref['ro number'])throw Error('Direct RO identity mismatch');
      await capture(ref['ro number']);
    }
    await save();console.log(JSON.stringify({narratives:state.records.length,completed_ros:state.completed_ros.length}));
  }else{
  if(await page.frame({name:'gutsPage'})?.locator('#selOpCode').isVisible().catch(()=>false)){
    const ro=(await page.frame({name:'gutsPage'}).locator('#txtRoNo').inputValue()).trim();await capture(ro);await clickText(page,'action','Exit');
  }else if(await page.frame({name:'gutsPage'})?.locator('#tblJob').isVisible().catch(()=>false)){
    const ro=(await page.frame({name:'gutsPage'}).locator('#txtRoNo').inputValue()).trim();await capture(ro);await clickText(page,'action','Exit');
  }
  if(!await page.frame({name:'gutsPage'})?.locator('#tblOpenRo').isVisible().catch(()=>false))await openReport();
  for(let guard=0;guard<1000;guard++){
    const report=await waitForReportPage(page,'#tblOpenRo','input[id="searchresults_AtbThree"]');
    const reportPage=report.page;
    const visible=report.values;
    const wanted=visible.filter(ro=>ids.has(ro)&&!state.completed_ros.includes(ro));
    // Returning from a detail can reset or reorder the report page. Re-read
    // its current links after every capture rather than using stale positions.
    for(const ro of wanted.slice(0,1)){
      const position=await until(async()=>{const i=await page.frame({name:'gutsPage'}).locator('#tblOpenRo input[id="searchresults_AtbThree"]').evaluateAll((es,ro)=>es.findIndex(e=>e.value.trim()===ro),ro);return i>=0?{index:i}:false;},'Narrative RO row');
      await page.frame({name:'gutsPage'}).locator('#tblOpenRo input[id="searchresults_AtbThree"]').nth(position.index).click();await until(async()=>await page.frame({name:'gutsPage'})?.locator('#txtCustNo').inputValue({timeout:500}).catch(()=>''),'RO detail');
      await capture(ro);await clickText(page,'action','Exit');
      await until(async()=>{await handleKnownSerialWarning(page);return await page.frame({name:'gutsPage'}).locator('#tblOpenRo').isVisible();},'Narrative report restored');
      await goToTablePage(page,'#tblOpenRo',reportPage);
    }
    if(state.completed_ros.length===refs.length)break;
    if(wanted.length)continue;
    const ready=await waitForReportPage(page,'#tblOpenRo','input[id="searchresults_AtbThree"]');
    if(ready.page===ready.pages)break;
    await page.frame({name:'gutsPage'}).locator('#tblOpenRo').locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]').locator('img[title="Move to next page"]').click();
    await until(async()=>{const first=await page.frame({name:'gutsPage'}).locator('#tblOpenRo input[id="searchresults_AtbThree"]').first().inputValue();return first.trim()&&first.trim()!==visible[0];},'Narrative next page');
  }
  await save();console.log(JSON.stringify({narratives:state.records.length,expected_jobs:jobs.length,completed_ros:state.completed_ros.length}));
  }
}catch(error){state.failures.push({error:error.message});await save();console.log('Narrative extraction stopped; see checkpoint.');process.exitCode=2;}
finally{await browser.close();}
