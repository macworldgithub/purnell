import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureSession, handleKnownSerialWarning } from './ensure-session.mjs';
import { loadedReportPage } from './report-pagination.mjs';

export const portalOrigin = 'https://c510778-erapower.pentana.cloud';

export async function connect({ portalIndex = 0 } = {}) {
  if (portalIndex === 0) await ensureSession();
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  let page = browser.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith(`${portalOrigin}/`))[portalIndex];
  if (!page && portalIndex !== 0) { await browser.close(); throw new Error('Requested existing eraPower tab unavailable'); }
  if (!page) {
    page = await browser.contexts()[0].newPage();
    await page.goto(`${portalOrigin}/base/templates/vIndependent.htm`, { waitUntil: 'domcontentloaded' });
    await until(async () => page.frame({ name: 'gutsPage' })?.locator('body').innerText({ timeout: 500 }), 'Pentana portal');
  }
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  if (await page.frame({ name: 'gutsPage' })?.locator('input[type="password"]').count()) {
    await browser.close();
    throw new Error('Pentana is signed out. Sign in in the Chrome window, then rerun.');
  }
  return { browser, page };
}

export async function until(check, description, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out: ${description}`);
}

export async function visibleLocator(page, frameName, selector, text = false) {
  return until(async () => {
    for (const frame of page.frames().filter(f => f.name() === frameName).reverse()) {
      const locator = text ? frame.getByText(selector, { exact: true }) : frame.locator(selector);
      for (const candidate of await locator.all()) {
        if (await candidate.isVisible()) return candidate;
      }
    }
  }, `${frameName}: ${selector}`);
}

export async function clickText(page, frame, text) {
  await (await visibleLocator(page, frame, text, true)).click();
}

export async function tablePageNumber(page, selector) {
  const table = page.frame({ name: 'gutsPage' }).locator(selector);
  const wrapper = table.locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]');
  const text = (await wrapper.locator('#CurrentPg').innerText()).replaceAll('\u00a0', ' ');
  const match = text.match(/Page\s+(\d+)\s+of/);
  if (!match) throw new Error('Report page number unavailable');
  return Number(match[1]);
}

export async function waitForReportPage(page, selector, valueSelector) {
  return until(async () => {
    const data = await page.frame({name:'gutsPage'}).locator(selector).evaluate((table, valueSelector) => {
      let wrapper = table.parentElement;
      while (wrapper && !wrapper.querySelector('[id="InfoTable"]')) wrapper = wrapper.parentElement;
      return { info: wrapper?.querySelector('[id="InfoTable"]')?.innerText || '', values: [...table.querySelectorAll(valueSelector)].map(e => e.value) };
    }, valueSelector);
    return loadedReportPage(data.info, data.values);
  }, 'Complete report page');
}

export async function goToTablePage(page, selector, number) {
  if (await tablePageNumber(page, selector) === number) return;
  const table = page.frame({ name: 'gutsPage' }).locator(selector);
  await table.locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]').locator('#CurrentPg span.SearchSelect').click();
  const input = await visibleLocator(page, 'guts', '#cbPosition');
  await input.click(); await input.fill(''); await input.pressSequentially(String(number), { delay: 40 }); await input.press('Tab');
  await clickText(page, 'action', 'OK');
  await until(async () => await tablePageNumber(page, selector) === number, 'Requested report page loaded');
}

export async function serviceMenu(page) {
  for (let i = 0; i < 7; i++) {
    await delay(400); // Legacy frames can show intermediate content during Exit.
    if (await handleKnownSerialWarning(page)) continue;
    const before = await until(async () => {
      const frame = page.frame({ name: 'gutsPage' });
      return await frame?.locator('body').innerText({ timeout: 1000 }).catch(() => '') || false;
    }, 'Pentana screen content', 30000);
    const messages = page.frames().filter(f => f.name() === 'guts');
    const message = messages.length ? await messages.at(-1).locator('body').innerText({ timeout: 500 }).catch(() => '') : '';
    if (/No (?:records|vehicles) found|mandatory field|Team is mandatory|Please enter a string you want to find first|Search criteria must|This software is optional|problems getting a valid response|must contain a valid date/i.test(message)) {
      await clickText(page, 'action', 'OK');
    } else {
      if (/Login Credentials/.test(before)) throw new Error('Pentana is signed out. No Exit action taken.');
      if (!before) throw new Error('Pentana screen has not loaded. No Exit action taken.');
      if (await page.frame({ name: 'gutsPage' })?.getByText('RO Costing', { exact: true }).isVisible().catch(() => false)) return;
      if (await page.frame({ name: 'gutsPage' })?.getByText('Service', { exact: true }).isVisible().catch(() => false)) {
        await clickText(page, 'gutsPage', 'Service');
        await until(async () => page.frame({ name: 'gutsPage' })?.getByText('RO Costing', { exact: true }).isVisible(), 'Service menu');
        return;
      }
      await clickText(page, 'action', 'Exit');
    }
    await until(async () => {
      if (messages.length && messages.at(-1).isDetached()) return true;
      const current = page.frame({ name: 'gutsPage' });
      const after = await current?.locator('body').innerText({ timeout: 500 }).catch(() => '');
      return after && after !== before && page.frames().some(f => f.name() === 'action');
    }, 'Exit finished');
  }
  throw new Error('Could not return to the Service menu. No record was saved.');
}

export async function metadata(page) {
  const frames = [];
  for (const frame of page.frames().filter(f => ['gutsPage', 'guts', 'action'].includes(f.name()))) {
    if (!await frame.locator('body').count()) continue;
    const data = await frame.locator('body').evaluate(body => ({
      name: window.name,
      text: body.innerText.slice(0, 8000),
      tables: [...body.querySelectorAll('table[id]')].map(t => ({
        id: t.id,
        rows: t.rows.length,
        headers: t.rows[0]?.innerText,
      })),
      controls: [...body.querySelectorAll('input, select, textarea, [onclick], img[title]')]
        .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
        .filter((e, i, all) => all.findIndex(o => o.tagName === e.tagName && o.id === e.id && o.getAttribute('title') === e.getAttribute('title')) === i)
        .map(e => ({ tag: e.tagName, id: e.id, name: e.getAttribute('name'), type: e.getAttribute('type'),
          title: e.title, label: e.type === 'button' ? e.value : e.innerText?.slice(0, 160),
          options: e.tagName === 'SELECT' ? [...e.options].map(o => ({ text: o.text, value: o.value })) : undefined,
        })),
    }));
    frames.push(data);
  }
  return { title: await page.title(), frames };
}
