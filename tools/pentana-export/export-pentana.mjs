import { mkdir, readFile, rename } from 'node:fs/promises';
import {atomicWriteFile as writeFile} from './atomic-file.mjs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, serviceMenu, clickText, until, visibleLocator, portalOrigin } from './pentana-ui.mjs';
import { parseCsv, toCsv } from './csv.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const fromDate = option('--from', '01/01/1900');
const toDate = option('--to', '31/12/2099');
const only = option('--only', '').split(',').filter(Boolean);
const output = resolve(option('--out', fileURLToPath(new URL(`./exports/${new Date().toISOString().replace(/[:.]/g, '-')}`, import.meta.url))));
await mkdir(output, { recursive: true });
const manifest = { started_at: new Date().toISOString(), source: portalOrigin, dealership: '01| Purnell Motors',
  appointment_date_range: { from: fromDate, to: toDate }, complete: false, datasets: [],
  limitations: [
    'This run is an export snapshot. It is not a live Pentana integration.',
    'A full customer/vehicle directory, authorised contacts, and service history require a verified bulk report or a complete record index.',
    'Parts Requests was explicitly denied to the signed-in account. No restricted endpoint is used.',
    'Advisor selector entries are a service-advisor directory, not a complete staff or telephone availability roster.',
    'Workshop status and appointment availability must be refreshed for live caller answers.',
  ] };
const saveManifest = () => writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
const { browser, page } = await connect();

async function route(...items) {
  await serviceMenu(page);
  for (const item of items) {
    const before = await page.frame({ name: 'gutsPage' }).locator('body').innerText();
    await clickText(page, 'gutsPage', item);
    await until(async () => {
      const messageFrame = page.frames().filter(f => f.name() === 'guts').at(-1);
      const message = messageFrame && await messageFrame.locator('body').innerText({ timeout: 500 }).catch(() => '');
      if (message?.includes('This software is optional')) throw new Error('Access denied by Pentana');
      const after = await page.frame({ name: 'gutsPage' })?.locator('body').innerText({ timeout: 500 }).catch(() => '');
      return after && after !== before;
    }, item);
  }
}

async function fill(selector, value) {
  const field = await visibleLocator(page, 'gutsPage', selector);
  await field.click();
  await field.press('ControlOrMeta+A');
  await field.fill('');
  await field.pressSequentially(value, { delay: 20 });
  if ((await field.inputValue()) !== value) throw new Error('Input value did not match requested filter');
  await field.press('Tab');
}

async function nativeCsv(name, selector) {
  const frame = page.frame({ name: 'gutsPage' });
  const table = frame.locator(selector);
  await table.waitFor({ state: 'visible' });
  const summary = await table.evaluate(table => {
    let wrapper = table.parentElement;
    while (wrapper && (!wrapper.querySelector('[id="Exp"]') || !wrapper.querySelector('[id="InfoTable"]'))) wrapper = wrapper.parentElement;
    const info = wrapper?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g, ' ') || '';
    const count = info.match(/Row\s+\d+\s+of\s+(\d+)/i);
    const populated = table.rows.length > 2 || [...table.rows].slice(1).some(r => [...r.querySelectorAll('input, textarea, select')].some(e => e.value?.trim()) || r.innerText.trim());
    return { expected: populated && count ? Number(count[1]) : 0, pagination: info, headers: table.rows[0]?.innerText };
  });
  // Find the export button belonging to this table, not another table on the page.
  const exportButton = table.locator('xpath=ancestor::*[.//*[@id="Exp"]][1]').locator('[id="Exp"]');
  const pending = page.waitForEvent('download', { timeout: 60000 });
  await exportButton.click();
  const download = await pending;
  const temporary = join(output, `${name}.csv.partial`);
  await download.saveAs(temporary);
  const bytes = await readFile(temporary);
  const parsed = parseCsv(bytes.toString('utf8'));
  if (parsed.rows.length !== summary.expected) throw new Error(`${name}: downloaded ${parsed.rows.length} rows; report shows ${summary.expected}. Partial file retained.`);
  await rename(temporary, join(output, `${name}.csv`));
  await page.screenshot({ path: join(output, `${name}.png`) }).catch(() => {});
  const result = { name, status: 'exported', file: `${name}.csv`, rows: parsed.rows.length, columns: parsed.headers,
    report_pagination: summary.pagination, sha256: createHash('sha256').update(bytes).digest('hex'), exported_at: new Date().toISOString() };
  manifest.datasets.push(result);
  await saveManifest();
  console.log(`${name}: ${result.rows} rows`);
  return parsed;
}

async function directory(selector, name, idHeader, nameHeader, labelOrder = 'name-first') {
  await until(async () => await page.frame({ name: 'gutsPage' }).locator(`${selector} option`).count() > 1, `${name} loaded`);
  const options = await page.frame({ name: 'gutsPage' }).locator(selector).evaluate(select => [...select.options].map(o => ({ value: o.value, text: o.text })));
  const rows = options.filter(o => o.value && !['ALL', 'All'].includes(o.value)).map(o => ({
    [idHeader]: o.value,
    [nameHeader]: labelOrder === 'id-first' ? o.text.replace(/^[^,]+,\s*/, '') : o.text.replace(/,\s*[^,]+$/, ''),
  }));
  const bytes = toCsv([idHeader, nameHeader], rows);
  await writeFile(join(output, `${name}.csv`), bytes);
  manifest.datasets.push({ name, status: 'exported', rows: rows.length, file: `${name}.csv`, source_control: selector,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  await saveManifest();
  console.log(`${name}: ${rows.length} entries`);
}

const jobs = {
  open_repair_orders: async () => {
    await route('Reports Menu', 'Open RO Report');
    const frame = page.frame({ name: 'gutsPage' });
    await frame.locator('#selDepartment').selectOption({ label: 'All Departments' });
    await frame.locator('#selAdvisor').selectOption({ label: 'All Advisors' });
    await clickText(page, 'action', 'Show Report');
    await until(async () => frame.locator('#tblOpenRo input').evaluateAll(fields => fields.some(f => f.value?.trim())), 'Open RO report data');
    return nativeCsv('open_repair_orders', '#tblOpenRo');
  },
  appointments: async () => {
    await route('Appointments Menu', 'Appointment Diary Detail');
    await directory('#selDropOffAdvisor', 'staff_advisors', 'advisor_id', 'advisor_name');
    await fill('#txtFromDate', fromDate);
    await fill('#txtToDate', toDate);
    await until(async () => (await page.frame({ name: 'gutsPage' }).locator('#txtFromDate').inputValue()) === fromDate && (await page.frame({ name: 'gutsPage' }).locator('#txtToDate').inputValue()) === toDate, 'Appointment dates retained');
    await page.frame({ name: 'gutsPage' }).locator('#chkRoNoJob').check();
    // The custom caption can detach after starting the report. Accept a click
    // timeout only if the subsequent independent report checks confirm data.
    await clickText(page, 'action', 'Show Report').catch(error => {
      if (!/Timeout/.test(error.message)) throw error;
    });
    await until(async () => {
      const frame = page.frame({ name: 'gutsPage' });
      const count = await frame.locator('#dspAppointments').inputValue();
      const cells = await frame.locator('#tblAppmtDiaryDtl input').evaluateAll(fields => fields.some(f => f.value?.trim()));
      const dialog = page.frames().filter(f => f.name() === 'guts').at(-1);
      if (dialog && await dialog.locator('body').innerText({ timeout: 500 }).catch(() => '')) return 'message';
      return /^\d+$/.test(count.trim()) && (cells || count === '0');
    }, 'Appointment report', 60000);
    const result = await nativeCsv('appointments', '#tblAppmtDiaryDtl');
    const frame = page.frame({ name: 'gutsPage' });
    const filters = { from: await frame.locator('#txtFromDate').inputValue(), to: await frame.locator('#txtToDate').inputValue(), include_no_jobs: await frame.locator('#chkRoNoJob').isChecked() };
    manifest.datasets.at(-1).appointment_count_displayed = await frame.locator('#dspAppointments').inputValue();
    manifest.datasets.at(-1).filters = filters;
    if (filters.from !== fromDate || filters.to !== toDate) manifest.datasets.at(-1).coverage_warning = 'Pentana changed the requested date filter. This is only the displayed report range.';
    await saveManifest();
    const capacity=await frame.locator('body').evaluate(body=>({
      department_id:body.querySelector('#selDepartment')?.value||'',advisor_id:body.querySelector('#selDropOffAdvisor')?.value||'',
      available_hours:body.querySelector('#dspAvailHours')?.value||'',sold_hours:body.querySelector('#dspSoldHours')?.value||'',
      unsold_hours:body.querySelector('#dspUnsoldHours')?.value||'',appointment_count_displayed:body.querySelector('#dspAppointments')?.value||'',
    }));
    const capacityRow={from_date:filters.from,to_date:filters.to,...capacity,detail_rows:String(result.rows.length),source:'Appointment Diary Detail aggregate capacity totals',exported_at:new Date().toISOString()};
    await writeFile(join(output,'appointment_capacity_totals.csv'),toCsv(Object.keys(capacityRow),[capacityRow]));
    manifest.datasets.push({name:'appointment_capacity_totals',status:'exported',file:'appointment_capacity_totals.csv',rows:1,scope:'Aggregate hours for the retained report date range; not individual bookable slots'});
    await saveManifest();
    return result;
  },
  workshop_status: async () => {
    await route('Workshop Control Menu', 'Workshop Control');
    await directory('#selFilter', 'workshop_status_codes', 'status_id', 'status_description');
    const frame = page.frame({ name: 'gutsPage' });
    await frame.locator('#selFilter').selectOption({ label: 'All' });
    await frame.locator('#selTeams').selectOption({ label: 'Service' });
    await frame.locator('#selTeams').selectOption({ label: 'Pre Delivery' });
    await clickText(page, 'action', 'Refresh');
    await until(async () => frame.locator('#tblInProgress input').evaluateAll(fields => fields.some(f => f.value?.trim())), 'Workshop report data');
    return nativeCsv('workshop_status', '#tblInProgress');
  },
  status_codes: async () => {
    await route('Service Setup Menu', 'Status Codes');
    await until(async () => page.frame({ name: 'gutsPage' }).locator('#tblStaticCodes input').evaluateAll(es => es.some(e => e.value.trim())), 'Status code values');
    return nativeCsv('status_codes', '#tblStaticCodes');
  },
};

try {
  await saveManifest();
  for (const name of only.length ? only : Object.keys(jobs)) {
    if (!jobs[name]) throw new Error(`Unknown export: ${name}. Choose ${Object.keys(jobs).join(', ')}`);
    try { await jobs[name](); }
    catch (error) {
      const dialogs = [];
      for (const f of page.frames().filter(f => f.name() === 'guts')) dialogs.push(await f.locator('body').innerText({ timeout: 500 }).catch(() => ''));
      manifest.datasets.push({ name, status: 'failed', error: error.message.split('\n')[0], messages: dialogs.filter(Boolean) });
      await page.screenshot({ path: join(output, `${name}-error.png`) }).catch(() => {});
      await saveManifest();
      console.log(`${name}: failed; see manifest.json`);
    }
  }
  manifest.finished_at = new Date().toISOString();
  manifest.complete = false; // The seven requested domains are not all accessible as bulk reports.
  await saveManifest();
  try { await serviceMenu(page); }
  catch(error) {
    manifest.cleanup_warning = error.message.split('\n')[0];
    await saveManifest();
    console.log('Reports saved; navigation cleanup warning recorded.');
  }
  console.log(`Saved: ${output}`);
  if (manifest.datasets.some(d => d.status === 'failed')) process.exitCode = 2;
} finally { await browser.close(); }
