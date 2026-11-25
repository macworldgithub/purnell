import {readFile} from 'node:fs/promises';
import {parseCsv} from './csv.mjs';
import {connect,clickText,visibleLocator,until} from './pentana-ui.mjs';
const records=parseCsv(await readFile('exports/run-2026-10-26/vehicles.csv','utf8')).records;
const serial=records.find(r=>r.serial_no.trim().length===17).serial_no.trim();
const {browser,page}=await connect();
try{
  for(const suffix of [false,true]){
    await clickText(page,'action','Reset');await page.waitForTimeout(300);
    let select=await visibleLocator(page,'gutsPage','#selSearchBy');
    await select.click();await select.selectOption({label:'Registration No'});await select.press('Tab');await page.waitForTimeout(300);
    select=await visibleLocator(page,'gutsPage','#selSearchBy');await select.click();await select.press('Home');await select.press('ArrowDown');await select.press('ArrowDown');await select.press('Enter');await select.press('Tab');await page.waitForTimeout(300);
    const field=await visibleLocator(page,'gutsPage','#txtSearchFld');await field.click();await field.press('ControlOrMeta+A');await field.pressSequentially(suffix?serial.slice(-7):serial,{delay:50});
    await clickText(page,'action','Find');
    const result=await until(async()=>{
      const message=await page.frames().filter(f=>f.name()==='guts').at(-1)?.locator('body').innerText({timeout:500}).catch(()=>'');
      if(/No records found|not found/i.test(message))return 'not_found';
      return await page.frame({name:'gutsPage'}).locator('#tblOwnedList input').evaluateAll((es,s)=>es.some(e=>e.value.trim()===s),serial)?'matched':false;
    },'known vehicle probe');
    console.log(JSON.stringify({method:suffix?'last_7':'full_serial',result}));
    if(result==='not_found')await clickText(page,'action','OK');
    if(result==='matched')break;
  }
}finally{await browser.close();}
