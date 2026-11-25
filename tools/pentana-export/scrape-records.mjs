import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, serviceMenu, clickText, visibleLocator, until, metadata } from './pentana-ui.mjs';
import { parseCsv, toCsv } from './csv.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const output = resolve(option('--out', fileURLToPath(new URL('./exports/run-2026-10-26/', import.meta.url))));
const mode = option('--mode', 'customers');
const limit = Number(option('--limit', 'Infinity'));
await mkdir(output, { recursive: true });
const report = parseCsv(await readFile(join(output, 'linked-record-index.csv'), 'utf8').catch(() => readFile(join(output, 'open_repair_orders.csv'), 'utf8')));
const ids = [...new Set(report.records.map(r => r['customer id']?.trim()).filter(Boolean))];
const fields = {
  era_name: 'entityname_eraname',
  customer_id: 'entityname_entityid', business_name: 'entityname_NameBusiness',
  first_name: 'entityname_namefirst', middle_name: 'entityname_namemiddle', last_name: 'entityname_namelast',
  preferred_name: 'entityname_namepreferred', mobile: 'entityname_mobile', home_phone: 'entityname_homephone',
  business_phone: 'entityname_businessphone', email: 'entityname_email', business_email: 'entityname_BusinessEmail',
  privacy_code: 'entityname_privacycode', customer_type: 'entityname_entityid_custype',
};
const { browser, page } = await connect();
const checkpointFile = join(output, `${mode}-checkpoint.json`);
const state = JSON.parse(await readFile(checkpointFile, 'utf8').catch(() => JSON.stringify({
  source: 'Pentana browser UI', scope: 'Customers referenced by this run\'s open repair orders; not the entire customer directory',
  records: [], failures: [], completed_ids: [],
})));
state.skipped_ids ??= [];
state.scope = 'Existing customers referenced by the exported open repair orders, appointment report and vehicle-history customer contexts; not the full dealership directory';
async function checkpoint() {
  state.updated_at = new Date().toISOString();
  await writeFile(checkpointFile, JSON.stringify(state, null, 2));
  const headers = mode === 'customers' ? ['full_name', ...Object.keys(fields), 'privacy_description', 'source', 'exported_at'] : [...new Set(state.records.flatMap(Object.keys))];
  for (const record of state.records) record.full_name = record.business_name || [record.first_name, record.middle_name, record.last_name].filter(Boolean).join(' ') || record.era_name || record.full_name || '';
  if (headers.length) await writeFile(join(output, `${mode}.csv`), toCsv(headers, state.records));
}
try {
  if (!await page.frame({ name: 'gutsPage' })?.locator('#entityname_namefirst').isVisible().catch(() => false)) {
    await serviceMenu(page);
    await clickText(page, 'gutsPage', 'Customer Maint Menu');
    await (await visibleLocator(page, 'gutsPage', 'Service Entity Maintenance', true)).waitFor({ state: 'visible' });
    await clickText(page, 'gutsPage', 'Service Entity Maintenance');
  }
  await visibleLocator(page, 'gutsPage', '#entityname_entityid');
  let done = 0;
  for (const id of ids.filter(id => !state.completed_ids.includes(id) && !state.skipped_ids.includes(id)).slice(0, limit)) {
    try {
      let field = await visibleLocator(page, 'gutsPage', '#entityname_entityid');
      if (await field.inputValue() || await page.frame({ name: 'gutsPage' }).locator('#entityname_namefirst, #entityname_namelast, #entityname_NameBusiness').evaluateAll(es => es.some(e => e.value.trim()))) {
        await clickText(page, 'action', 'Cancel');
        await until(async () => page.frame({ name: 'gutsPage' }).locator('#entityname_entityid, #entityname_namefirst, #entityname_namelast, #entityname_NameBusiness, #entityname_eraname').evaluateAll(es => es.length === 5 && es.every(e => !e.value.trim())), 'customer reset');
        await page.waitForTimeout(200);
        field = await visibleLocator(page, 'gutsPage', '#entityname_entityid');
      }
      await field.click();
      await field.press('ControlOrMeta+A');
      await field.pressSequentially(id, { delay: 30 });
      if (await field.inputValue() !== id) throw new Error('Lookup text changed before submission');
      await field.press('Tab');
      const loaded = await until(async () => {
        const dialog = page.frames().filter(f => f.name() === 'guts').at(-1);
        const message = await dialog?.locator('body').innerText({ timeout: 500 }).catch(() => '');
        if (/Entity does not exist/.test(message)) return 'missing';
        const f = page.frame({ name: 'gutsPage' });
        return await f.locator('#entityname_namefirst, #entityname_namelast, #entityname_NameBusiness, #entityname_eraname').evaluateAll(es => es.some(e => e.value.trim()));
      }, 'customer loaded');
      if (loaded === 'missing') {
        const modal = page.frames().filter(f => f.name() === 'guts').at(-1);
        const message = await modal.locator('body').innerText();
        const returnedId = message.match(/with the id\s+([^\s?]+)/i)?.[1];
        await clickText(page, 'action', 'No');
        if (returnedId && returnedId !== id) throw new Error('Missing-record dialog returned a different customer ID');
        state.skipped_ids.push(id);
        state.failures.push({ customer_id: id, error: 'Pentana reports entity does not exist. Creation declined.' });
        await checkpoint();
        continue;
      }
      const f = page.frame({ name: 'gutsPage' });
      const record = await f.locator('body').evaluate((body, fields) => Object.fromEntries(Object.entries(fields).map(([key, control]) => {
        const element = body.querySelector(`[id="${control}"]`);
        if (!element) throw new Error('Requested customer field is unavailable');
        return [key, element.value];
      })), fields);
      if (record.customer_id.trim() !== id) throw new Error('Customer identifier mismatch');
      record.privacy_description = await f.locator('#entityname_privacycode').evaluate(e => e.selectedOptions[0]?.text || '');
      record.source = 'Service Entity Maintenance';
      record.exported_at = new Date().toISOString();
      state.records.push(record);
      state.completed_ids.push(id);
      await checkpoint();
      console.log(`customers: ${state.records.length}/${ids.length}`);
      if (++done === 1) {
        await writeFile(join(output, 'customer-screen-metadata.json'), JSON.stringify(await metadata(page), null, 2));
        await page.screenshot({ path: join(output, 'customer-screen.png') });
      }
    } catch (error) {
      state.failures.push({ customer_id: id, error: error.message.split('\n')[0] });
      await checkpoint();
      const dialog = page.frames().filter(f => f.name() === 'guts').at(-1);
      const message = await dialog?.locator('body').innerText({ timeout: 500 }).catch(() => '');
      if (/mandatory field|problems getting a valid response/.test(message)) {
        await clickText(page, 'action', 'OK');
      } else if (/password to modify/.test(message)) {
        await clickText(page, 'action', 'Cancel');
      } else if (message) {
        console.log('Customer lookup stopped at an unrecognised dialog; see checkpoint.');
        break;
      }
      console.log('Customer lookup failed; continuing with the next existing record.');
    }
  }
  await checkpoint();
  console.log(JSON.stringify({ exported: state.records.length, source_customer_ids: ids.length, failures: state.failures.length }));
} finally { await browser.close(); }
