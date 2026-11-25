import { readFile } from 'node:fs/promises';
import {atomicWriteFile as writeFile} from './atomic-file.mjs';
import { join, resolve } from 'node:path';
import { connect, serviceMenu, clickText, visibleLocator, until } from './pentana-ui.mjs';
import { parseCsv, toCsv } from './csv.mjs';
const output=resolve(process.argv[2]||'exports/run-2026-10-26');
const appointments=parseCsv(await readFile(process.argv[3]||'exports/appointments-2026-10-26/appointments.csv','utf8'));
const stateFile=join(output,'vehicles-checkpoint.json');
const state=JSON.parse(await readFile(stateFile,'utf8'));
state.serial_failures??=[];state.skipped_serials??=[];
const serials=[...new Set(appointments.records.map(r=>r['serial no'].trim()).filter(Boolean))];
const existing=new Set(state.records.map(r=>r.serial_no.trim()));
const todo=serials.filter(s=>!existing.has(s)&&!state.skipped_serials.includes(s));
const headers=['customer_ids','referenced_registrations','registration','serial_no','year','make','colour','stock_no','carline','model_description','source','exported_at'];
async function save(){
  for(const r of state.records){
    r.source='Pentana vehicle search UI';
    r.referenced_registrations=[...new Set([r.registration,...appointments.records.filter(a=>a['serial no'].trim()===r.serial_no.trim()).map(a=>a['rego no'])].filter(Boolean))].join('|');
  }
  state.updated_at=new Date().toISOString();
  state.scope='Vehicle records referenced by open repair orders and appointment report, resolved by serial number where registrations are ambiguous';
  await writeFile(stateFile,JSON.stringify(state,null,2));
  await writeFile(join(output,'vehicles.csv'),toCsv(headers,state.records));
}
const {browser,page}=await connect();
async function chooseSerial(){
  let select=await visibleLocator(page,'gutsPage','#selSearchBy');
  await select.click();await select.selectOption({label:'Registration No'});await select.press('Tab');await page.waitForTimeout(200);
  select=await visibleLocator(page,'gutsPage','#selSearchBy');
  await select.click();await select.press('Home');await select.press('ArrowDown');await select.press('ArrowDown');await select.press('Enter');await select.press('Tab');await page.waitForTimeout(200);
}
try{
  await serviceMenu(page);await clickText(page,'gutsPage','Vehicle Information');
  await visibleLocator(page,'gutsPage','#selSearchBy');
  await chooseSerial();
  for(const serial of todo){
    try{
      if(await page.frame({name:'gutsPage'}).locator('#selSearchBy').inputValue()!=='S'){
        await chooseSerial();
      }
      const field=await visibleLocator(page,'gutsPage','#txtSearchFld');
      await field.click();await field.press('ControlOrMeta+A');await field.pressSequentially(serial,{delay:25});
      if((await field.inputValue()).trim()!==serial)throw new Error('Serial search text changed');
      await clickText(page,'action','Find');
      const loaded=await until(async()=>{
        const modal=page.frames().filter(f=>f.name()==='guts').at(-1);
        const message=await modal?.locator('body').innerText({timeout:500}).catch(()=>'');
        if(/No records found|not found/i.test(message))return 'missing';
        return await page.frame({name:'gutsPage'}).locator('#tblOwnedList input').evaluateAll((es,s)=>es.some(e=>e.value.trim()===s),serial);
      },'vehicle serial lookup');
      if(loaded==='missing'){
        await clickText(page,'action','OK');state.skipped_serials.push(serial);await save();continue;
      }
      const table=page.frame({name:'gutsPage'}).locator('#tblOwnedList');
      const info=await table.evaluate(t=>{let w=t.parentElement;while(w&&(!w.querySelector('[id="Exp"]')||!w.querySelector('[id="InfoTable"]')))w=w.parentElement;return w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ');});
      const expected=Number(info?.match(/Row\s+\d+\s+of\s+(\d+)/i)?.[1]);
      const columns=['serial no','year','make','rego no','colour','stock no','carline','model description'];
      const visible=await table.evaluate(t=>({
        headers:[...t.rows[0].cells].map(c=>c.innerText.trim().toLowerCase().replace(/\s+/g,' ')),
        rows:[...t.rows].slice(1).map(r=>[...r.cells].map(c=>c.querySelector('input')?.value??c.innerText.trim())),
      }));
      const exactShape=JSON.stringify(visible.headers)===JSON.stringify(columns)&&visible.rows.length===expected&&visible.rows.every(r=>r.length===columns.length&&r[0].trim()===serial);
      let parsed;
      if(exactShape&&!process.argv.includes('--verify-dom')){
        parsed={rows:visible.rows,records:visible.rows.map(r=>Object.fromEntries(columns.map((c,i)=>[c,r[i]])))};
      }else{
      const pending=page.waitForEvent('download',{timeout:20000});
      await table.locator('xpath=ancestor::*[.//*[@id="Exp"]][1]').locator('[id="Exp"]').click();
      const download=await pending;const temp=join(output,'vehicle-serial-download.csv.partial');await download.saveAs(temp);
      parsed=parseCsv(await readFile(temp,'utf8'));
      if(parsed.rows.length!==expected)throw new Error('Vehicle serial export count mismatch');
      if(process.argv.includes('--verify-dom')){
        if(!exactShape||JSON.stringify(parsed.rows)!==JSON.stringify(visible.rows))throw new Error('Visible vehicle table differs from native export');
        console.log('Visible vehicle row matched native CSV');
      }
      }
      for(const r of parsed.records){
        if(r['serial no'].trim()!==serial)throw new Error('Returned serial mismatch');
        if(!state.records.some(x=>x.serial_no.trim()===serial))state.records.push({
          customer_ids:[...new Set(appointments.records.filter(a=>a['serial no'].trim()===serial).map(a=>a.custno).filter(Boolean))].join('|'),
          registration:r['rego no'],serial_no:r['serial no'],year:r.year,make:r.make,colour:r.colour,stock_no:r['stock no'],
          carline:r.carline,model_description:r['model description'],source:'Pentana vehicle search UI',exported_at:new Date().toISOString(),
        });
      }
      await save();console.log(`vehicle records: ${state.records.length}; serials remaining: ${todo.length-todo.indexOf(serial)-1}`);
      await clickText(page,'action','Reset');await until(async()=>!(await page.frame({name:'gutsPage'}).locator('#txtSearchFld').inputValue()),'serial reset');await page.waitForTimeout(200);
    }catch(error){state.serial_failures.push({serial_no:serial,error:error.message.split('\n')[0]});await save();console.log('Serial lookup stopped; see checkpoint.');break;}
  }
  await save();console.log(JSON.stringify({vehicle_records:state.records.length,missing_serials:state.skipped_serials.length}));
}finally{await browser.close();}
