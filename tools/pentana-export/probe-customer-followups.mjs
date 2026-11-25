import {readFile} from 'node:fs/promises';
import {parseCsv} from './csv.mjs';
import {connect,clickText,visibleLocator,until} from './pentana-ui.mjs';
const c=parseCsv(await readFile('exports/run-2026-10-26/customers.csv','utf8')).records.find(r=>r.first_name&&r.mobile);
const {browser,page}=await connect();
try{
  await clickText(page,'action','Reset');await page.waitForTimeout(200);
  let s=await visibleLocator(page,'gutsPage','#selSearchBy');await s.click();await s.press('Home');for(let i=0;i<4;i++)await s.press('ArrowDown');await s.press('Enter');await s.press('Tab');await page.waitForTimeout(200);
  const field=await visibleLocator(page,'gutsPage','#txtSearchFld');await field.click();await field.press('ControlOrMeta+A');await field.pressSequentially(c.customer_id,{delay:30});await clickText(page,'action','Find');
  const result=await until(async()=>{
    const f=page.frame({name:'gutsPage'});const body=await f.locator('body').innerText();const id=body.match(/Vehicle\(s\) Display for:\s*(.*?)\s+-/)?.[1]?.trim();
    const message=await page.frames().filter(f=>f.name()==='guts').at(-1)?.locator('body').innerText({timeout:500}).catch(()=>'');
    return id===c.customer_id?'matched':message||false;
  },'Customer follow-up context');
  console.log(JSON.stringify({result}));
}finally{await browser.close();}
