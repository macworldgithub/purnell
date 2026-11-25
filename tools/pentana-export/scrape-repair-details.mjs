import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, serviceMenu, clickText, visibleLocator, until, metadata } from './pentana-ui.mjs';
import { parseCsv, toCsv } from './csv.mjs';
const args = process.argv.slice(2);
const opt = (k,v) => args.includes(k) ? args[args.indexOf(k)+1] : v;
const output = resolve(opt('--out', fileURLToPath(new URL('./exports/run-2026-10-26/', import.meta.url))));
const source = parseCsv(await readFile(join(output, 'open_repair_orders.csv'), 'utf8'));
const stateFile = join(output, 'repair-details-checkpoint.json');
const state = JSON.parse(await readFile(stateFile, 'utf8').catch(() => JSON.stringify({records:[], completed_ids:[], failures:[]})));
const fields = { ro_number:'txtRoNo', department:'txtRoDept', customer_id:'txtCustNo', customer_name:'txtCustName',
  advisor_id:'txtAdvNo', advisor_name:'txtAdvName', registration:'txtRegoNo', serial_no:'txtSerialNo',
  mileage:'txtMileage', date_in:'txtRoDateIn', time_in:'txtRoTimeIn', promised_date:'txtPromDate',
  promised_time:'txtPromTime', mobile:'txtMobPhone', home_phone:'txtHomePhone', business_phone:'txtBusPhone',
  comments:'txtComments', recommendations:'txtRoRecom', vehicle_description:'txtStockDesc' };
const headers=[...Object.keys(fields),'source','exported_at'];
async function save(){await writeFile(stateFile,JSON.stringify(state,null,2));await writeFile(join(output,'repair_order_details.csv'),toCsv(headers,state.records));}
const {browser,page}=await connect();
try {
  await serviceMenu(page);
  await clickText(page,'gutsPage','RO Review');
  await visibleLocator(page,'gutsPage','#txtRoNo');
  const limit=Number(opt('--limit','Infinity'));
  for(const ref of source.records.filter(r=>!state.completed_ids.includes(r['ro number'])).slice(0,limit)){
    try {
      let field=await visibleLocator(page,'gutsPage','#txtRoNo');
      if(await field.inputValue()){
        await clickText(page,'action','Cancel');
        await until(async()=>!(await page.frame({name:'gutsPage'}).locator('#txtRoNo').inputValue()),'RO reset');
        await page.waitForTimeout(200);
        field=await visibleLocator(page,'gutsPage','#txtRoNo');
      }
      await field.click();await field.press('ControlOrMeta+A');await field.pressSequentially(ref['ro number'],{delay:25});
      // RO Review has only one editable field; Tab may wrap back into it.
      // Clicking the visible heading commits the lookup without saving a record.
      await page.frame({name:'gutsPage'}).getByText('RO Review',{exact:true}).click();
      await until(async()=>await page.frame({name:'gutsPage'}).locator('#txtCustNo').inputValue(),'RO loaded');
      const record=await page.frame({name:'gutsPage'}).locator('body').evaluate((body,fields)=>Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,body.querySelector(`[id="${id}"]`)?.value??''])),fields);
      if(record.ro_number.trim()!==ref['ro number'].trim())throw new Error('Returned RO number mismatch');
      if(record.customer_id.trim()!==ref['customer id'].trim())throw new Error('Returned RO customer mismatch');
      record.source='RO Review';record.exported_at=new Date().toISOString();
      state.records.push(record);state.completed_ids.push(ref['ro number']);await save();
      console.log(`repair details: ${state.records.length}/${source.records.length}`);
      if(state.records.length===1)await writeFile(join(output,'repair-screen-metadata.json'),JSON.stringify(await metadata(page),null,2));
    }catch(error){state.failures.push({ro_number:ref['ro number'],error:error.message.split('\n')[0]});await save();console.log('Repair detail lookup stopped; see checkpoint.');break;}
  }
  await save();
}finally{await browser.close();}
