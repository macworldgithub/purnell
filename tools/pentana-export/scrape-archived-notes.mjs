import {readFile,writeFile} from 'node:fs/promises';
import {parseCsv,toCsv} from './csv.mjs';
import {connect,serviceMenu,clickText,until} from './pentana-ui.mjs';
const out='exports/followup-2026-11-12';
const read=async n=>parseCsv(await readFile(`${out}/${n}.csv`,'utf8')).records;
const [coverage,details,jobs]=await Promise.all(['repair_narrative_coverage','repair_order_details','repair_order_jobs'].map(read));
const targets=[...new Set(coverage.filter(r=>r.status!=='exported').map(r=>r.ro_number))];
const file=out+'/archived-notes-checkpoint.json';
const state=JSON.parse(await readFile(file,'utf8').catch(()=>JSON.stringify({records:[],summaries:[],queries:[],completed:[]})));
if(process.argv.includes('--retry')){state.previous_attempts=[...(state.previous_attempts||[]),...state.queries];state.completed=state.completed.filter(ro=>state.queries.some(q=>q.ro_number===ro&&q.status==='historical_notes_exported'&&q.rows>0));state.queries=state.queries.filter(q=>q.status==='historical_notes_exported'&&q.rows>0);state.summaries=state.summaries.filter(r=>state.completed.includes(r.ro_number));}
const fields={source_ro_number:'txtRoNo',operation_code:'txtOpCode',operation_description:'txtOpDesc',operation_long_description:'txaCompleteOpDesc',department:'selDepartment',sale_type:'selSaleType',technician_no:'txtTechNo',complaint:'txaComplaint',cause:'txaCause',correction:'txaCorrection',technician_instructions:'txaTechInstr',customer_instructions:'txaCustInstr'};
async function save(){await writeFile(file,JSON.stringify(state,null,2));await writeFile(out+'/archived_repair_job_narratives.csv',toCsv(['ro_number','serial_no','job_index',...Object.keys(fields),'warranty_claim_rows_json','source','exported_at'],state.records));await writeFile(out+'/archived_repair_context.csv',toCsv(['ro_number','serial_no','source_ro_number','ro_date','advisor_id','mileage','campaign_1','campaign_1_description','campaign_2','campaign_2_description','source','exported_at'],state.summaries));await writeFile(out+'/archived_repair_query_coverage.csv',toCsv(['ro_number','status','rows','exported_at'],state.queries));}
const{browser,page}=await connect();const f=()=>page.frame({name:'gutsPage'});
async function paging(table){const wrap=table.locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]');const info=(await wrap.locator('[id="InfoTable"]').innerText()).replaceAll('\u00a0',' ');const p=info.match(/Page\s+(\d+)\s+of\s+(\d+)/);return {wrap,info,p};}
async function next(table){const{wrap,info,p}=await paging(table);if(!p||p[1]===p[2])return false;await wrap.locator('img[title="Move to next page"]').click();await until(async()=>(await paging(table)).info!==info,'History pagination');return true;}
try{
 for(const ro of targets.filter(r=>!state.completed.includes(r))){
  const detail=details.find(r=>r.ro_number===ro);const serial=detail.serial_no;
  await page.waitForTimeout(500);await serviceMenu(page);await clickText(page,'gutsPage','Customer Maint Menu');await clickText(page,'gutsPage','RO History');
  for(const label of ['Registration No','Serial No']){await f().locator('#selSearchBy').focus();await f().locator('#selSearchBy').selectOption({label});await f().locator('#txtSearchFld').focus();await page.waitForTimeout(200);}
  const q=f().locator('#txtSearchFld');await q.click();await q.press('ControlOrMeta+A');await q.pressSequentially(serial,{delay:25});await clickText(page,'action','Find');
  await until(async()=>f().locator('#tblOwnedList input[id="searchresults_ColOne"]').evaluateAll((es,s)=>es.some(e=>e.value.trim()===s),serial),'Archive vehicle');
  for(const e of await f().locator('#tblOwnedList input[id="searchresults_ColOne"]').all())if((await e.inputValue()).trim()===serial){await e.click();break;}
  await f().locator('#tblRoHist').waitFor({state:'visible'});
  await until(async()=>(await f().locator('#txtSerialNo').inputValue()).trim()===serial,'History serial loaded');
  await page.waitForLoadState('networkidle',{timeout:1500}).catch(()=>{});
  await until(async()=>await f().locator('#tblRoHist input[id="searchresults_AtbOne"]').evaluateAll(es=>es.some(e=>e.value.trim()))||await f().locator('#txtTotRo').inputValue()==='0','History rows loaded');
  let found=false;
  do{for(const e of await f().locator('#tblRoHist input[id="searchresults_AtbOne"]').all())if((await e.inputValue()).trim()===ro){await e.click();found=true;break;}}while(!found&&await next(f().locator('#tblRoHist')));
  if(!found){state.queries.push({ro_number:ro,status:'not_found_in_vehicle_history',rows:0,exported_at:new Date().toISOString()});state.completed.push(ro);await save();continue;}
  await f().locator('#selRoNo').waitFor({state:'visible'});
  await until(async()=>await f().locator('#selRoNo').inputValue(),'Historical RO selection');
  await until(async()=>f().locator('#tblJob input[id="searchresults_AtbOne"]').evaluateAll(es=>es.some(e=>e.value.trim())),'Historical job rows');
  if((await f().locator('#txtSerialNo').inputValue()).trim()!==serial)throw Error('Archived vehicle mismatch');
  const sourceRo=await f().locator('#selRoNo').inputValue();
  const summary=await f().locator('body').evaluate(b=>Object.fromEntries(Object.entries({ro_date:'txtRoDate',advisor_id:'txtAdvisor',mileage:'txtMileage',campaign_1:'txtFstCampNo',campaign_1_description:'txtFstCampDesc',campaign_2:'txtScndCampNo',campaign_2_description:'txtScndCampDesc'}).map(([k,id])=>[k,b.querySelector('#'+id).value])));
  state.summaries.push({ro_number:ro,serial_no:serial,source_ro_number:sourceRo,...summary,source:'Service History Maintenance; historical campaign fields, not open campaign status',exported_at:new Date().toISOString()});
  const pending=[];let index=0;
  do{
   const jobPage=Number((await paging(f().locator('#tblJob'))).p[1]);
   const count=await f().locator('#tblJob input[id="searchresults_AtbOne"]').count();
   for(let i=0;i<count;i++){
    const e=f().locator('#tblJob input[id="searchresults_AtbOne"]').nth(i);const op=(await e.inputValue()).trim();if(!op)continue;index++;
    await e.click();await f().locator('#txtOpCode').waitFor({state:'visible'});
    await until(async()=>(await f().locator('#txtOpCode').inputValue()).trim()===op&&(await f().locator('#txtRoNo').inputValue()).trim()===sourceRo.trim(),'Archived job loaded');
    await page.waitForLoadState('networkidle',{timeout:1000}).catch(()=>{});
    const record=await f().locator('body').evaluate((b,fields)=>Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,b.querySelector('#'+id)?.value??''])),fields);
    if(record.source_ro_number.trim()!==sourceRo.trim()||record.operation_code.trim()!==op)throw Error('Archive job identity mismatch');
    const claims=await f().locator('#tblWarranty tr').evaluateAll(rs=>rs.slice(1).map(r=>[...r.querySelectorAll('input')].map(e=>e.value)).filter(r=>r.some(v=>v.trim())));
    pending.push({ro_number:ro,serial_no:serial,job_index:String(index),...record,warranty_claim_rows_json:JSON.stringify(claims),source:'Service History Maintenance RO Job Details; read only',exported_at:new Date().toISOString()});
    await clickText(page,'action','Exit');
    await until(async()=>await f().locator('#selRoNo').isVisible()||await f().locator('#tblRoHist').isVisible(),'History return');
    if(await f().locator('#tblRoHist').isVisible()){
     await until(async()=>f().locator('#tblRoHist input[id="searchresults_AtbOne"]').evaluateAll(es=>es.some(e=>e.value.trim())),'History list returned');
     let reopened=false;
     do{for(const h of await f().locator('#tblRoHist input[id="searchresults_AtbOne"]').all())if((await h.inputValue()).trim()===ro){await h.click();reopened=true;break;}}while(!reopened&&await next(f().locator('#tblRoHist')));
     if(!reopened)throw Error('Unable to reopen verified historical RO');
    }
    await f().locator('#selRoNo').waitFor({state:'visible'});await until(async()=>f().locator('#tblJob input[id="searchresults_AtbOne"]').evaluateAll(es=>es.some(e=>e.value.trim())),'Historical jobs returned');
    while(Number((await paging(f().locator('#tblJob'))).p[1])<jobPage){if(!await next(f().locator('#tblJob')))throw Error('Unable to restore historical job page');await page.waitForTimeout(300);}
   }
  }while(await next(f().locator('#tblJob')));
  state.records.push(...pending);state.queries.push({ro_number:ro,status:'historical_notes_exported',rows:pending.length,exported_at:new Date().toISOString()});state.completed.push(ro);await save();console.log(`Archive queries: ${state.completed.length}/${targets.length}; job notes: ${state.records.length}`);
 }
}finally{await save();await browser.close();}
