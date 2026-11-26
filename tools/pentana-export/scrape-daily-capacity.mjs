import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, serviceMenu, clickText, until } from './pentana-ui.mjs';
import { atomicWriteFile } from './atomic-file.mjs';
import { toCsv } from './csv.mjs';
import { parseDailyCapacity } from './daily-capacity.mjs';

const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const { browser, page } = await connect();
try {
  await serviceMenu(page);
  await clickText(page, 'gutsPage', 'Appointments Menu');
  await clickText(page, 'gutsPage', 'Service Appointments');
  const frame = () => page.frame({ name: 'gutsPage' });
  await until(async () => await frame().locator('#selDepartment option').count() > 1, 'Capacity department loaded');
  const dept = frame().locator('#selDepartment');
  await dept.focus(); await dept.selectOption({ label: 'Service' }); await dept.press('Tab');
  await until(async () => await frame().locator('#selAdvisor option').count() > 1, 'Capacity advisors loaded');
  const advisor = frame().locator('#selAdvisor');
  await advisor.focus(); await advisor.selectOption({ label: 'All' }); await advisor.press('Tab');
  // Select filters before changing dates: the legacy form validates department on blur.
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const date = frame().locator('#txtFromDate');
  await date.click(); await date.press('ControlOrMeta+A'); await date.fill(''); await date.pressSequentially(today, { delay: 25 }); await date.press('Tab');
  await clickText(page, 'action', 'Refresh');
  await page.waitForTimeout(1500);
  const result = await until(async () => {
    const snapshot = { department: await frame().locator('#selDepartment').inputValue(), advisor_scope: (await frame().locator('#selAdvisor option:checked').innerText()).trim().toLowerCase(), text: await frame().locator('body').innerText(), messages: await Promise.all(page.frames().filter(f => f.name() === 'guts').map(f => f.locator('body').innerText({ timeout: 500 }).catch(() => ''))) };
    const observedAt = new Date().toISOString();
    const rows = parseDailyCapacity(snapshot, observedAt);
    const [day, month, year] = today.split('/');
    const isoToday = `${year}-${month}-${day}`;
    if (!rows.some(row => row.date === isoToday) || rows.at(-1).date <= isoToday) return false;
    return { snapshot, observedAt, rows };
  }, 'Verified current capacity calendar', 45000);
  const csv = toCsv(Object.keys(result.rows[0]), result.rows);
  await atomicWriteFile(join(output, 'daily_booking_capacity.csv'), csv);
  await atomicWriteFile(join(output, 'source-calendar.json'), JSON.stringify(result.snapshot, null, 2));
  const runId = 'daily-capacity-' + result.observedAt.replace(/[:.]/g, '-');
  await atomicWriteFile(join(output, 'full-sync-manifest.json'), JSON.stringify({ runId, startedAt: result.observedAt, datasets: [{ name: 'daily_booking_capacity', file: 'daily_booking_capacity.csv', rows: result.rows.length, sha256: createHash('sha256').update(csv).digest('hex'), complete: false, report_window_complete: true }], failures: [], limitations: ['Daily Service capacity across all advisors; exact time slots and job-specific eligibility are unverified.'] }, null, 2));
  console.log(JSON.stringify({ dataset: 'daily_booking_capacity', rows: result.rows.length, observedAt: result.observedAt, from: result.rows[0].date, to: result.rows.at(-1).date }));
  await serviceMenu(page).catch(() => console.log('Capacity saved; navigation cleanup pending.'));
} finally { await browser.close(); }
