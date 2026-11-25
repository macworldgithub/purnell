import {readFile,writeFile} from 'node:fs/promises';
import {connect,clickText,visibleLocator,until,metadata} from './pentana-ui.mjs';
import {parseCsv} from './csv.mjs';
const vehicles=parseCsv(await readFile('exports/run-2026-10-26/vehicles.csv','utf8')).records;
const serial=vehicles.find(v=>v.customer_ids!=='10000'&&v.serial_no.length===17).serial_no;
const {browser,page}=await connect();
try{
  let s=await visibleLocator(page,'gutsPage','#selSearchBy');await s.click();await s.selectOption({label:'Registration No'});await s.press('Tab');await page.waitForTimeout(150);
  s=await visibleLocator(page,'gutsPage','#selSearchBy');await s.click();await s.press('Home');await s.press('ArrowDown');await s.press('ArrowDown');await s.press('Enter');await s.press('Tab');await page.waitForTimeout(150);
  const field=await visibleLocator(page,'gutsPage','#txtSearchFld');await field.click();await field.press('ControlOrMeta+A');await field.pressSequentially(serial,{delay:25});await clickText(page,'action','Find');
  await until(async()=>page.frame({name:'gutsPage'}).locator('#tblOwnedList input').evaluateAll((es,s)=>es.some(e=>e.value.trim()===s),serial),'Follow-up vehicle');
  await page.frame({name:'gutsPage'}).getByText('Warning Messages / Follow-up Contact Details',{exact:true}).click();
  await page.frame({name:'gutsPage'}).locator('#tblContactHist').waitFor({state:'visible'});await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
  const data=await metadata(page);await writeFile('.local/followup-discovery.json',JSON.stringify(data,null,2));
  console.log(JSON.stringify({title:data.title,frames:data.frames.map(f=>({name:f.name,text:f.text.slice(0,1200),tables:f.tables,controls:f.controls.filter(c=>c.tag!=='IMG').slice(-20)}))}));
}finally{await browser.close();}
