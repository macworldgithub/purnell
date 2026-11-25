import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect, serviceMenu, clickText, until } from './pentana-ui.mjs';
import { toCsv } from './csv.mjs';
const output = resolve(process.argv[2]);
const { browser, page } = await connect();
const limitations = [];
const failures = [];
const exported = [];
const frame = () => page.frame({ name: 'gutsPage' });
async function loadOptions(selector) {
  await frame().locator(selector).waitFor({ state: 'visible' });
  await frame().locator(selector).focus();
  await until(async () => await frame().locator(selector + ' option').count() > 1, 'Lookup options loaded: ' + selector);
  await page.waitForTimeout(250);
}
function download(selector, name) {
  const child = spawnSync(process.execPath, ['download-current.mjs', selector, name, output], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (child.status !== 0) throw new Error('Native export failed for ' + name);
}
try {
  try {
    await serviceMenu(page); await clickText(page, 'gutsPage', 'Workshop Control Menu'); await clickText(page, 'gutsPage', 'Workshop Control');
    await loadOptions('#selTeams');
    for (const label of ['Service','Pre Delivery']) {
      const control = frame().locator('#selTeams');
      await control.focus(); await control.selectOption({ label }); await control.press('Tab'); await page.waitForTimeout(400);
    }
    await until(async () => await frame().locator('#selTeams').inputValue() === 'S' && /Pre Delivery/.test(await frame().locator('#dsaTeams').inputValue()), 'Both workshop teams retained');
    await loadOptions('#selFilter');
    const statusOptions = await frame().locator('#selFilter option').evaluateAll(es => es.filter(e => e.value).map(e => ({ status_id: e.value, status_description: e.text })));
    if(!statusOptions.length)throw new Error('Workshop status options did not load');
    await writeFile(join(output, 'workshop_status_codes.csv'), toCsv(['status_id', 'status_description'], statusOptions));
    exported.push('workshop_status_codes');
    const statusFilter = frame().locator('#selFilter');
    await statusFilter.focus(); await statusFilter.selectOption({ label: 'All' }); await statusFilter.press('Tab');
    await clickText(page, 'action', 'Refresh');
    const modal = page.frames().filter(f => f.name() === 'guts').at(-1);
    const text = await modal?.locator('body').innerText({ timeout: 500 }).catch(() => '');
    if (/Team is mandatory/.test(text || '')) { await clickText(page, 'action', 'OK'); await clickText(page, 'action', 'Refresh'); }
    await until(async () => frame().locator('#tblInProgress input').evaluateAll(es => es.some(e => e.value.trim())), 'Workshop rows');
    download('#tblInProgress', 'workshop_status');
    exported.push('workshop_status');
  } catch (error) { failures.push({ stage: 'workshop', error: error.message }); }
  try {
    await serviceMenu(page); await clickText(page, 'gutsPage', 'Loan Car System');
    await until(async () => frame().locator('#tblBookings input').evaluateAll(es => es.some(e => e.value.trim())), 'Courtesy vehicle rows');
    await clickText(page, 'action', 'Refresh');
    await page.waitForTimeout(1000);
    download('#tblBookings', 'loan_car_status');
    exported.push('loan_car_status');
    limitations.push('Courtesy vehicle export covers All Vehicles for the displayed report day; all-booking history is not verified.');
  } catch (error) { failures.push({ stage: 'courtesy vehicles', error: error.message }); }
  try {
    await serviceMenu(page); await clickText(page, 'gutsPage', 'Reports Menu'); await clickText(page, 'gutsPage', 'Open RO Report');
    await loadOptions('#selDepartment');
    const rows = await frame().locator('#selDepartment option').evaluateAll(es => es.filter(e => e.value && !/^All Departments$/i.test(e.text.trim())).map(e => ({ department_id: e.value, department_label: e.text })));
    if(!rows.length)throw new Error('Service department options did not load');
    await writeFile(join(output, 'service_department_options.csv'), toCsv(['department_id', 'department_label'], rows));
    exported.push('service_department_options');
  } catch (error) { failures.push({ stage: 'Service department directory', error: error.message }); }
  try {
    await serviceMenu(page); await clickText(page, 'gutsPage', 'Reports Menu'); await clickText(page, 'gutsPage', 'FSA Report');
    await loadOptions('#selAdvisor');
    const rows = await frame().locator('#selAdvisor option').evaluateAll(es => es.filter(e => e.value && e.value !== 'All').map(e => ({ advisor_id: e.value, advisor_name: e.text })));
    if(!rows.length)throw new Error('FSA advisor options did not load');
    await writeFile(join(output, 'fsa_advisors.csv'), toCsv(['advisor_id', 'advisor_name'], rows));
    exported.push('fsa_advisors');
  } catch (error) { failures.push({ stage: 'FSA advisor directory', error: error.message }); }
  try {
    await serviceMenu(page); await clickText(page, 'gutsPage', 'Customer Maint Menu'); await clickText(page, 'gutsPage', 'Service Entity Maintenance');
    await loadOptions('#entityname_privacycode');
    const rows = await frame().locator('#entityname_privacycode option').evaluateAll(es => es.filter(e => e.value).map(e => ({ code: e.value, description: e.text })));
    if(!rows.length)throw new Error('Privacy code options did not load');
    await writeFile(join(output, 'customer_privacy_codes.csv'), toCsv(['code', 'description'], rows));
    exported.push('customer_privacy_codes');
  } catch (error) { failures.push({ stage: 'Privacy code definitions', error: error.message }); }
  try {
    await serviceMenu(page); await clickText(page, 'gutsPage', 'Parts Requests'); await page.waitForTimeout(600);
    const message = await page.frames().filter(f => f.name() === 'guts').at(-1)?.locator('body').innerText({ timeout: 500 }).catch(() => '');
    if (/optional|specified users|denied/i.test(message || '')) {
      limitations.push('Parts Requests denied this account or is unavailable in its setup.'); await clickText(page, 'action', 'OK');
    } else limitations.push('Parts Requests is now accessible and requires a verified parts export mapping.');
  } catch (error) { failures.push({ stage: 'parts access check', error: error.message }); }
} finally {
  await writeFile(join(output, 'ancillary-status.json'), JSON.stringify({ limitations, failures, exported }, null, 2));
  await browser.close();
}
if (failures.length) process.exitCode = 2;
