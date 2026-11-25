import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {connect,serviceMenu,clickText,visibleLocator,until} from './pentana-ui.mjs';
import {parseCsv,toCsv} from './csv.mjs';
const out=resolve(process.argv[2]||'exports/run-2026-10-26');
const vehicles=parseCsv(await readFile(join(out,'vehicles.csv'),'utf8')).records;
const serials=[...new Set(vehicles.map(v=>v.serial_no.trim()).filter(Boolean))];
const file=join(out,'history-checkpoint.json');
const state=JSON.parse(await readFile(file,'utf8').catch(()=>JSON.stringify({rows:[],summaries:[],contacts:[],completed_serials:[],failures:[]})));
const headers=['serial_no','row_index','ro_number','ro_date','mileage','advisor','operation_code','operation_description','cwi','technician_no','source','exported_at'];
const summaryHeaders=['serial_no','history_screen_customer_id','total_ros_displayed','total_service_days_displayed','history_rows','source','exported_at'];
const contactFields={customer_id:'entityname_entityid',era_name:'entityname_eraname',preferred_name:'entityname_namepreferred',home_phone:'entityname_homephone',business_phone:'entityname_businessphone',mobile:'entityname_mobile',customer_type:'entityname_entityid_custype'};
const {browser,page}=await connect();
async function save(){
  state.updated_at=new Date().toISOString();await writeFile(file,JSON.stringify(state,null,2));
  await writeFile(join(out,'service_history.csv'),toCsv(headers,state.rows));
  await writeFile(join(out,'service_history_summary.csv'),toCsv(summaryHeaders,state.summaries));
  await writeFile(join(out,'history_customer_context.csv'),toCsv(['serial_no',...Object.keys(contactFields),'source','exported_at'],state.contacts));
}
async function chooseSerial(){
  let s=await visibleLocator(page,'gutsPage','#selSearchBy');await s.click();await s.selectOption({label:'Registration No'});await s.press('Tab');await page.waitForTimeout(150);
  s=await visibleLocator(page,'gutsPage','#selSearchBy');await s.click();await s.press('Home');await s.press('ArrowDown');await s.press('ArrowDown');await s.press('Enter');await s.press('Tab');await page.waitForTimeout(150);
}
async function historyCapture(serial){
  const f=page.frame({name:'gutsPage'});
  const details=await f.locator('body').evaluate((body,fields)=>({
    serial:body.querySelector('#txtSerialNo')?.value,
    total_ros:body.querySelector('#txtTotRo')?.value,
    total_days:body.querySelector('#txtTotSvcDays')?.value,
    contact:Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,body.querySelector(`[id="${id}"]`)?.value??''])),
  }),contactFields);
  if(details.serial?.trim()!==serial)throw new Error('History serial mismatch');
  const rows=[];
  for(let guard=0;guard<200;guard++){
    const table=page.frame({name:'gutsPage'}).locator('#tblRoHist');
    const data=await table.evaluate(t=>{let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;return {info:w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'',rows:[...t.rows].slice(1).map(r=>[...r.querySelectorAll('input')].map(e=>e.value))};});
    const total=Number(data.info.match(/Row\s+\d+\s+of\s+(\d+)/i)?.[1]);const p=data.info.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if(!p)throw new Error('History pagination not loaded');
    for(const r of data.rows){if(!r[0]?.trim())continue;if(r.length!==8)throw new Error('Unexpected history columns');rows.push({serial_no:serial,row_index:String(rows.length+1),ro_number:r[0],ro_date:r[1],mileage:r[2],advisor:r[3],operation_code:r[4],operation_description:r[5],cwi:r[6],technician_no:r[7]});}
    if(p[1]===p[2]){if(rows.length!==total&&!(total===1&&rows.length===0))throw new Error('History rows do not match displayed total');break;}
    if(guard===199)throw new Error('History pagination limit reached before the final page');
    await table.locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]').locator('img[title="Move to next page"]').click();
    await until(async()=>await page.frame({name:'gutsPage'}).locator('#tblRoHist').evaluate(t=>{let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;return w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'';})!==data.info,'History page');
  }
  const when=new Date().toISOString();for(const r of rows){r.source='RO History Display';r.exported_at=when;}
  if(/^\d+$/.test(details.total_ros||'')&&new Set(rows.map(r=>r.ro_number)).size!==Number(details.total_ros))throw new Error('Unique history RO count does not match Total ROs');
  state.rows.push(...rows);state.summaries.push({serial_no:serial,history_screen_customer_id:details.contact.customer_id,total_ros_displayed:details.total_ros,total_service_days_displayed:details.total_days,history_rows:String(rows.length),source:'RO History Display',exported_at:when});
  state.contacts.push({serial_no:serial,...details.contact,source:'RO History Display customer context; not an authorisation record',exported_at:when});
  state.completed_serials.push(serial);await save();console.log(`history vehicles: ${state.completed_serials.length}/${serials.length}; history rows: ${state.rows.length}`);
}
async function openSearch(){
  await serviceMenu(page);await clickText(page,'gutsPage','Customer Maint Menu');await clickText(page,'gutsPage','RO History Display');await visibleLocator(page,'gutsPage','#txtSearchFld');await page.waitForTimeout(200);await chooseSerial();
}
try{
  if(await page.frame({name:'gutsPage'})?.locator('#tblRoHist').isVisible().catch(()=>false)){
    const s=(await page.frame({name:'gutsPage'}).locator('#txtSerialNo').inputValue()).trim();if(serials.includes(s)&&!state.completed_serials.includes(s))await historyCapture(s);await clickText(page,'action','Exit');
  }
  if(!await page.frame({name:'gutsPage'})?.locator('#txtSearchFld').isVisible().catch(()=>false))await openSearch();else await chooseSerial();
  for(const serial of serials.filter(s=>!state.completed_serials.includes(s))){
    try{
      await page.waitForTimeout(500);
      let reset=false;
      for(let attempt=0;attempt<3&&!reset;attempt++){
        await clickText(page,'action','Reset');
        reset=!!await until(async()=>!(await page.frame({name:'gutsPage'}).locator('#txtSearchFld').inputValue()),'History search reset',2000).catch(()=>false);
      }
      if(!reset)throw new Error('History search did not reset');
      await page.waitForTimeout(200);
      if(await page.frame({name:'gutsPage'}).locator('#selSearchBy').inputValue()!=='S')await chooseSerial();
      const field=await visibleLocator(page,'gutsPage','#txtSearchFld');await field.click();await field.press('ControlOrMeta+A');await field.pressSequentially(serial);if((await field.inputValue()).trim()!==serial)throw new Error('History lookup text changed');
      let position;
      for(let attempt=0;attempt<3&&!position;attempt++){
        await clickText(page,'action','Find');
        position=await until(async()=>{const i=await page.frame({name:'gutsPage'}).locator('#tblOwnedList input').evaluateAll((es,s)=>es.findIndex(e=>e.value.trim()===s),serial);return i>=0?{index:i}:false;},'History vehicle',4000).catch(()=>null);
      }
      if(!position)throw new Error('History vehicle search did not return the requested serial');
      await page.frame({name:'gutsPage'}).locator('#tblOwnedList input').nth(position.index).click();
      await until(async()=>await page.frame({name:'gutsPage'})?.locator('#txtSerialNo').inputValue({timeout:500}).catch(()=>'')===serial,'History display');
      await historyCapture(serial);await clickText(page,'action','Exit');await visibleLocator(page,'gutsPage','#txtSearchFld');
    }catch(error){state.failures.push({serial_no:serial,error:error.message.split('\n')[0]});await save();console.log('History extraction stopped; see checkpoint.');break;}
  }
  await save();console.log(JSON.stringify({history_vehicles:state.completed_serials.length,expected_vehicles:serials.length,history_rows:state.rows.length}));
}finally{await browser.close();}
