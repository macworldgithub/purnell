import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, serviceMenu, clickText, visibleLocator, until, metadata } from './pentana-ui.mjs';
import { parseCsv } from './csv.mjs';
const vehicles = parseCsv(await readFile(new URL('./exports/run-2026-10-26/vehicles.csv', import.meta.url), 'utf8'));
const serial = vehicles.records.find(r => r.customer_ids !== '10000' && r.serial_no.length === 17).serial_no;
const { browser, page } = await connect();
try {
  await serviceMenu(page);
  await clickText(page, 'gutsPage', 'Customer Maint Menu');
  await clickText(page, 'gutsPage', 'RO History Display');
  await visibleLocator(page, 'gutsPage', '#txtSearchFld');
  await page.waitForTimeout(300);
  let select=await visibleLocator(page,'gutsPage','#selSearchBy');
  await select.click();await select.selectOption({label:'Registration No'});await select.press('Tab');await page.waitForTimeout(200);
  select=await visibleLocator(page,'gutsPage','#selSearchBy');await select.click();await select.press('Home');await select.press('ArrowDown');await select.press('ArrowDown');await select.press('Enter');await select.press('Tab');await page.waitForTimeout(200);
  const field = await visibleLocator(page, 'gutsPage', '#txtSearchFld');
  await field.click(); await field.press('ControlOrMeta+A'); await field.pressSequentially(serial, { delay: 50 });
  if ((await field.inputValue()).trim() !== serial) throw new Error('History search text changed before submission');
  await clickText(page, 'action', 'Find');
  await until(async () => page.frame({ name: 'gutsPage' }).locator('#tblOwnedList input').evaluateAll((es, serial) => es.some(e => e.value.trim() === serial), serial), 'history vehicle');
  await page.frame({ name: 'gutsPage' }).locator('#tblOwnedList input').first().click();
  await page.waitForTimeout(500);
  const data = await metadata(page);
  await writeFile(new URL('./.local/history-discovery.json', import.meta.url), JSON.stringify(data, null, 2));
  await page.screenshot({ path: fileURLToPath(new URL('./.local/history-discovery.png', import.meta.url)) });
  console.log(JSON.stringify({ title: data.title, frames: data.frames.map(f => ({name:f.name,text:f.text.slice(0,1800),tables:f.tables,controls:f.controls.filter(c => c.tag !== 'IMG' && !c.id?.startsWith('searchresults')).slice(0,45)})) }));
} finally { await browser.close(); }
