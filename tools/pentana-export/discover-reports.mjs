import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, serviceMenu, clickText, metadata, until } from './pentana-ui.mjs';

const { browser, page } = await connect();
const discoveries = JSON.parse(await readFile(new URL('./.local/discovery/screens.json', import.meta.url), 'utf8').catch(() => '{}'));
await mkdir(new URL('./.local/discovery/', import.meta.url), { recursive: true });
try {
  for (const route of [
    ['Appointments Menu', 'Service Appointments'],
    ['Appointments Menu', 'Appointment Log'],
    ['Appointments Menu', 'Appointment Diary Detail'],
    ['Workshop Control Menu', 'Customer Vehicle Status'],
    ['Workshop Control Menu', 'Workshop Control'],
    ['Service Setup Menu', 'Status Codes'],
  ]) {
    const label = route.at(-1);
    await serviceMenu(page);
    for (const item of route) {
      const before = await page.frame({ name: 'gutsPage' }).locator('body').innerText();
      await clickText(page, 'gutsPage', item);
      await until(async () => {
        const after = await page.frame({ name: 'gutsPage' })?.locator('body').innerText({ timeout: 500 }).catch(() => '');
        const dialog = page.frames().filter(f => f.name() === 'guts').at(-1);
        return (after && after !== before) || (dialog && await dialog.locator('body').innerText({ timeout: 500 }).catch(() => ''));
      }, item);
    }
    await until(async () => {
      const dialog = page.frames().filter(f => f.name() === 'guts').at(-1);
      return (dialog && await dialog.locator('body').innerText({ timeout: 500 }).catch(() => '')) || !(await page.frame({ name: 'gutsPage' }).getByText('RO Costing', { exact: true }).isVisible().catch(() => false));
    }, label);
    await page.screenshot({ path: fileURLToPath(new URL(`./.local/discovery/${label.replaceAll(' ', '_')}.png`, import.meta.url)) });
    discoveries[label] = await metadata(page);
    await writeFile(new URL('./.local/discovery/screens.json', import.meta.url), JSON.stringify(discoveries, null, 2));
    console.log(JSON.stringify({ screen: label, title: discoveries[label].title, frames: discoveries[label].frames.map(f => ({name:f.name,text:f.text.slice(0,2000),tables:f.tables,controls:f.controls.filter(c=>c.tag!=='IMG' && !c.id?.startsWith('searchresults'))})) }));
  }
  await serviceMenu(page);
} finally { await browser.close(); }
