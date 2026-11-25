import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, serviceMenu, clickText, until, metadata } from './pentana-ui.mjs';
import { parseCsv } from './csv.mjs';
const report = parseCsv(await readFile(new URL('./exports/run-2026-10-26/open_repair_orders.csv', import.meta.url), 'utf8'));
const ro = report.records[0]['ro number'];
const { browser, page } = await connect();
try {
  await serviceMenu(page);
  await clickText(page, 'gutsPage', 'Reports Menu');
  await clickText(page, 'gutsPage', 'Open RO Report');
  await until(async () => page.frame({name:'gutsPage'}).locator('#selDepartment').isVisible(), 'Open RO filters');
  await page.frame({name:'gutsPage'}).locator('#selDepartment').selectOption({label:'All Departments'});
  await page.frame({name:'gutsPage'}).locator('#selAdvisor').selectOption({label:'All Advisors'});
  await clickText(page,'action','Show Report');
  const index = await until(async () => {
    const i = await page.frame({name:'gutsPage'}).locator('#tblOpenRo input').evaluateAll((es,ro)=>es.findIndex(e=>e.value.trim()===ro),ro);
    return i >= 0 ? {value:i} : null;
  },'RO report reference');
  await page.frame({name:'gutsPage'}).locator('#tblOpenRo input').nth(index.value).click();
  await until(async () => await page.frame({name:'gutsPage'})?.locator('#txtCustNo').inputValue({timeout:500}).catch(()=>''),'linked RO detail',10000).catch(()=>{});
  const data=await metadata(page);
  await writeFile(new URL('./.local/ro-link-discovery.json',import.meta.url),JSON.stringify(data,null,2));
  await page.screenshot({path:fileURLToPath(new URL('./.local/ro-link-discovery.png',import.meta.url))});
  console.log(JSON.stringify({title:data.title,frames:data.frames.map(f=>({name:f.name,text:f.text.slice(0,1400),tables:f.tables,controls:f.controls.filter(c=>c.tag!=='IMG'&&!c.id?.startsWith('searchresults')).slice(0,45)}))}));
}finally{await browser.close();}
