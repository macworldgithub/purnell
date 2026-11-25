import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, serviceMenu, clickText, visibleLocator, until, metadata } from './pentana-ui.mjs';
import { parseCsv, toCsv } from './csv.mjs';
const args = process.argv.slice(2);
const opt = (k, v) => args.includes(k) ? args[args.indexOf(k) + 1] : v;
const output = resolve(opt('--out', fileURLToPath(new URL('./exports/run-2026-10-26/', import.meta.url))));
const limit = Number(opt('--limit', 'Infinity'));
const source = parseCsv(await readFile(join(output, 'linked-record-index.csv'), 'utf8').catch(() => readFile(join(output, 'open_repair_orders.csv'), 'utf8')));
const regos = [...new Set(source.records.map(r => r.rego.trim()).filter(Boolean))];
const checkpoint = join(output, 'vehicles-checkpoint.json');
const state = JSON.parse(await readFile(checkpoint, 'utf8').catch(() => JSON.stringify({
  scope: 'Vehicles referenced by exported open repair orders; not a full dealership vehicle directory',
  records: [], completed_regos: [], failures: [],
})));
const headers = ['customer_ids', 'registration', 'serial_no', 'year', 'make', 'colour', 'stock_no', 'carline', 'model_description', 'source', 'exported_at'];
state.scope = 'Vehicles referenced by the exported open repair orders and appointment report; not the full dealership vehicle directory';
async function save() {
  state.updated_at = new Date().toISOString();
  await writeFile(checkpoint, JSON.stringify(state, null, 2));
  await writeFile(join(output, 'vehicles.csv'), toCsv(headers, state.records));
}
const { browser, page } = await connect();
try {
  if (!await page.frame({ name: 'gutsPage' })?.locator('#txtSearchFld').isVisible().catch(() => false)) {
    await serviceMenu(page);
    await clickText(page, 'gutsPage', 'Vehicle Information');
  }
  let field = await visibleLocator(page, 'gutsPage', '#txtSearchFld');
  if (await page.frame({ name: 'gutsPage' }).locator('#selSearchBy').inputValue() !== 'R') {
    await page.frame({ name: 'gutsPage' }).locator('#selSearchBy').selectOption({ label: 'Registration No' });
    await page.waitForTimeout(300);
  }
  for (const rego of regos.filter(r => !state.completed_regos.includes(r)).slice(0, limit)) {
    try {
      field = await visibleLocator(page, 'gutsPage', '#txtSearchFld');
      await field.click();
      await field.press('ControlOrMeta+A');
      await field.pressSequentially(rego, { delay: 20 });
      if ((await field.inputValue()).trim() !== rego) throw new Error('Search text changed before submission');
      await clickText(page, 'action', 'Find');
      await until(async () => page.frame({ name: 'gutsPage' }).locator('#tblOwnedList input').evaluateAll((es, rego) => es.some(e => e.value.trim().toUpperCase() === rego.toUpperCase()), rego), 'vehicle results');
      const f = page.frame({ name: 'gutsPage' });
      const table = f.locator('#tblOwnedList');
      const before = await table.evaluate(t => {
        let wrapper = t.parentElement;
        while (wrapper && (!wrapper.querySelector('[id="Exp"]') || !wrapper.querySelector('[id="InfoTable"]'))) wrapper = wrapper.parentElement;
        return wrapper?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g, ' ');
      });
      const pending = page.waitForEvent('download', { timeout: 20000 });
      await table.locator('xpath=ancestor::*[.//*[@id="Exp"]][1]').locator('[id="Exp"]').click();
      const download = await pending;
      const temp = join(output, 'vehicle-download.csv.partial');
      await download.saveAs(temp);
      const parsed = parseCsv(await readFile(temp, 'utf8'));
      const expected = Number(before?.match(/Row\s+\d+\s+of\s+(\d+)/i)?.[1]);
      if (!Number.isInteger(expected) || parsed.rows.length !== expected) throw new Error('Vehicle export count does not match report');
      for (const r of parsed.records) {
        const get = (...keys) => keys.map(k => r[k]).find(v => v !== undefined) ?? '';
        const record = {
          customer_ids: [...new Set(source.records.filter(r => r.rego.trim() === rego).map(r => r['customer id']))].join('|'),
          registration: get('rego no', 'Rego No'), serial_no: get('serial no', 'Serial No'), year: get('year', 'Year'),
          make: get('make', 'Make'), colour: get('colour', 'Colour'), stock_no: get('stock no', 'Stock No'),
          carline: get('carline', 'Carline'), model_description: get('model description', 'Model Description'),
          source: 'Pentana vehicle search UI', exported_at: new Date().toISOString(),
        };
        if (record.registration.trim().toUpperCase() !== rego.toUpperCase()) throw new Error('Vehicle registration mismatch');
        state.records.push(record);
      }
      state.completed_regos.push(rego);
      await save();
      console.log(`vehicles: ${state.completed_regos.length}/${regos.length}`);
      if (state.completed_regos.length === 1) {
        await writeFile(join(output, 'vehicle-screen-metadata.json'), JSON.stringify(await metadata(page), null, 2));
        await page.screenshot({ path: join(output, 'vehicle-screen.png') });
      }
      await clickText(page, 'action', 'Reset');
      await until(async () => !(await page.frame({ name: 'gutsPage' }).locator('#txtSearchFld').inputValue()), 'vehicle search reset');
      await page.waitForTimeout(300);
    } catch (error) {
      state.failures.push({ registration: rego, error: error.message.split('\n')[0] });
      await save();
      console.log('Vehicle lookup stopped; see checkpoint.');
      break;
    }
  }
  await save();
  console.log(JSON.stringify({ rows: state.records.length, completed_regos: state.completed_regos.length, source_regos: regos.length }));
} finally { await browser.close(); }
