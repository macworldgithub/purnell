import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {connect,serviceMenu,clickText,until} from './pentana-ui.mjs';
import {parseCsv,toCsv} from './csv.mjs';
const out=resolve(process.argv[2]||'exports/run-2026-10-26');
const refs=parseCsv(await readFile(join(out,'open_repair_orders.csv'),'utf8')).records;
const expected=new Map(refs.map(r=>[r['ro number'],r]));
const stateFile=join(out,'repair-report-checkpoint.json');
const state=JSON.parse(await readFile(stateFile,'utf8').catch(()=>JSON.stringify({records:[],jobs:[],completed_ids:[],failures:[]})));
const fields={ro_number:'txtRoNo',department:'txtRoDept',customer_id:'txtCustNo',customer_name:'txtCustName',advisor_id:'txtAdvNo',advisor_name:'txtAdvName',registration:'txtRegoNo',serial_no:'txtSerialNo',mileage:'txtMileage',date_in:'txtRoDateIn',time_in:'txtRoTimeIn',promised_date:'txtPromDate',promised_time:'txtPromTime',mobile:'txtMobPhone',home_phone:'txtHomePhone',business_phone:'txtBusPhone',comments:'txtComments',recommendations:'txtRoRecom',vehicle_description:'txtStockDesc'};
const {browser,page}=await connect();
async function save(){
  state.updated_at=new Date().toISOString();await writeFile(stateFile,JSON.stringify(state,null,2));
  await writeFile(join(out,'repair_order_details.csv'),toCsv([...Object.keys(fields),'ro_status','source','exported_at'],state.records));
  await writeFile(join(out,'repair_order_jobs.csv'),toCsv(['ro_number','job_index','operation_code','department','sale_type','status'],state.jobs));
}
async function capture(){
  const f=page.frame({name:'gutsPage'});
  const r=await f.locator('body').evaluate((body,fields)=>{
    const r=Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,body.querySelector(`[id="${id}"]`)?.value??'']));
    r.ro_status=body.innerText.match(/Status -\s*([^\n]+)/)?.[1]?.trim()||'';return r;
  },fields);
  const ref=expected.get(r.ro_number.trim());
  if(!ref)throw new Error('Linked RO is outside the source report');
  if(r.customer_id.trim()!==ref['customer id'].trim())throw new Error('Linked RO customer mismatch');
  if(state.completed_ids.includes(r.ro_number.trim()))return;
  let jobs=[];
  for(let guard=0;guard<1000;guard++){
    const table=page.frame({name:'gutsPage'}).locator('#tblJob');
    const data=await table.evaluate(t=>{
      let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;
      const info=w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'';
      return {info,rows:[...t.rows].slice(1).map(row=>[...row.querySelectorAll('input')].map(e=>e.value))};
    });
    const total=Number(data.info.match(/Row\s+\d+\s+of\s+(\d+)/i)?.[1]);
    const paging=data.info.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    for(const values of data.rows){
      if(!values[0]?.trim())continue;
      if(values.length!==5)throw new Error('Unexpected job columns');
      jobs.push({ro_number:r.ro_number,job_index:String(jobs.length+1),operation_code:values[0],department:values[1],sale_type:values[2],status:values[4]});
    }
    if(!paging||paging[1]===paging[2]){
      if(jobs.length!==total&&!(total===1&&jobs.length===0))throw new Error('Job rows do not match the report total');
      break;
    }
    await table.locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]').locator('img[title="Move to next page"]').click();
    await until(async()=>await page.frame({name:'gutsPage'}).locator('#tblJob').evaluate(t=>{let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;return w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ');})!==data.info,'RO job page');
  }
  r.source='RO Review opened from Open RO Report';r.exported_at=new Date().toISOString();
  state.records.push(r);state.jobs.push(...jobs);state.completed_ids.push(r.ro_number.trim());await save();
  console.log(`repair details: ${state.records.length}/${refs.length}; job rows: ${state.jobs.length}`);
}
async function openReport(){
  await serviceMenu(page);await clickText(page,'gutsPage','Reports Menu');await clickText(page,'gutsPage','Open RO Report');
  await until(async()=>page.frame({name:'gutsPage'}).locator('#selDepartment').isVisible(),'RO filters');
  await page.frame({name:'gutsPage'}).locator('#selDepartment').selectOption({label:'All Departments'});
  await page.frame({name:'gutsPage'}).locator('#selAdvisor').selectOption({label:'All Advisors'});await clickText(page,'action','Show Report');
  await until(async()=>page.frame({name:'gutsPage'}).locator('#tblOpenRo input').evaluateAll(es=>es.some(e=>e.value.trim())),'RO report');
}
try{
  if(await page.frame({name:'gutsPage'})?.locator('#txtCustNo').inputValue({timeout:500}).catch(()=>'')){
    await capture();await clickText(page,'action','Exit');
  }
  if(!await page.frame({name:'gutsPage'})?.locator('#tblOpenRo').isVisible().catch(()=>false))await openReport();
  for(let guard=0;guard<100;guard++){
    await until(async()=>page.frame({name:'gutsPage'}).locator('#tblOpenRo input[id="searchresults_AtbThree"]').evaluateAll(es=>es.some(e=>e.value.trim())),'RO rows ready');
    const table=page.frame({name:'gutsPage'}).locator('#tblOpenRo');
    const visible=await table.locator('input[id="searchresults_AtbThree"]').evaluateAll(es=>es.map(e=>e.value.trim()));
    state.report_page_size??=visible.filter(Boolean).length;
    const wanted=[...new Set(visible.filter(v=>expected.has(v)&&!state.completed_ids.includes(v)))];
    for(const ro of wanted.slice(0,1)){
      const position=await until(async()=>{const index=await page.frame({name:'gutsPage'}).locator('#tblOpenRo input[id="searchresults_AtbThree"]').evaluateAll((es,ro)=>es.findIndex(e=>e.value.trim()===ro),ro);return index>=0?{index}:null;},'RO reference ready');
      await page.frame({name:'gutsPage'}).locator('#tblOpenRo input[id="searchresults_AtbThree"]').nth(position.index).click();
      await until(async()=>await page.frame({name:'gutsPage'})?.locator('#txtCustNo').inputValue({timeout:500}).catch(()=>''),'Linked RO');
      await capture();await clickText(page,'action','Exit');
      await until(async()=>page.frame({name:'gutsPage'}).locator('#tblOpenRo').isVisible(),'Return to RO report');
    }
    if(state.completed_ids.length===refs.length)break;
    if(wanted.length)continue;
    const ready=await until(async()=>{const info=await page.frame({name:'gutsPage'}).locator('#tblOpenRo').evaluate(t=>{let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;return w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'';});const total=Number(info.match(/Row\s+\d+\s+of\s+(\d+)/i)?.[1]);const pages=Number(info.match(/Page\s+\d+\s+of\s+(\d+)/i)?.[1]);return total===refs.length&&pages===Math.ceil(refs.length/state.report_page_size)?{info}:false;},'RO pagination ready');
    const info=ready.info;
    const paging=info.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if(!paging||paging[1]===paging[2]||state.completed_ids.length===refs.length)break;
    await page.frame({name:'gutsPage'}).locator('#tblOpenRo').locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]').locator('img[title="Move to next page"]').click();
    await until(async()=>await page.frame({name:'gutsPage'}).locator('#tblOpenRo').evaluate(t=>{let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;return w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'';})!==info,'Next RO page');
    await until(async()=>{const first=await page.frame({name:'gutsPage'}).locator('#tblOpenRo input[id="searchresults_AtbThree"]').first().inputValue();return first.trim()&&first.trim()!==visible[0];},'Next RO rows');
  }
  state.unresolved_ids=refs.map(r=>r['ro number']).filter(id=>!state.completed_ids.includes(id));await save();
  console.log(JSON.stringify({repair_details:state.records.length,jobs:state.jobs.length,unresolved:state.unresolved_ids.length}));
}catch(error){state.failures.push({error:error.message});await save();console.log('RO report extraction stopped; see checkpoint.');process.exitCode=2;}
finally{await browser.close();}
