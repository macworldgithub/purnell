import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
try {
  const [command, frameName, text, extra] = process.argv.slice(2);
  const pentanaPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://c510778-erapower.pentana.cloud/'));
  if (!pentanaPage) {
    console.log(JSON.stringify({ pages: await Promise.all(browser.contexts().flatMap(c => c.pages()).map(async p => ({ title: await p.title(), origin: p.url() === 'about:blank' ? 'about:blank' : new URL(p.url()).origin }))) }));
    throw new Error('No Pentana tab remains open.');
  }
  pentanaPage.setDefaultTimeout(8000);
  const targetFrame = name => pentanaPage.frames().filter(f => f.name() === name).at(-1);
  if (command === 'search-all') {
    await targetFrame('action').getByText('OK', { exact: true }).click();
    await targetFrame('guts').locator('#txtSearchName1').fill('*');
    await targetFrame('action').getByText('Find', { exact: true }).click();
  }
  await pentanaPage.setViewportSize({ width: 1600, height: 1000 });
  if (command === 'click') {
    await targetFrame(frameName).getByText(text, { exact: true }).click();
  }
  if (command === 'select') {
    await targetFrame(frameName).locator(text).selectOption({ label: extra });
    await targetFrame(frameName).locator(text).press('Tab');
  }
  if (command === 'selector-click') {
    await targetFrame(frameName).locator(text).click();
  }
  if (command === 'menu') {
    const input = pentanaPage.frame({ name: 'toolb' }).locator('input#MenuCombo');
    await input.fill(frameName);
    await input.press('Enter');
  }
  if (command === 'press') await targetFrame(frameName).locator(text).press(extra);
  if (command === 'right-click') await targetFrame(frameName).locator(text).click({ button: 'right' });
  if (command === 'download') {
    await mkdir(new URL('./exports/raw/', import.meta.url), { recursive: true });
    const pending = pentanaPage.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await targetFrame(frameName).locator(text).click();
    const download = await pending;
    if (download) {
      const path = fileURLToPath(new URL(`./exports/raw/${download.suggestedFilename().replace(/[^a-zA-Z0-9._-]/g, '_')}`, import.meta.url));
      await download.saveAs(path);
      console.log(JSON.stringify({ downloaded: path }));
    } else console.log('No download event. Inspect any export dialog.');
  }
  if (command === 'dom') {
    console.log(await pentanaPage.frame({ name: frameName }).locator(text).evaluate(el => el.outerHTML.slice(0, 16000)));
  }
  await mkdir(new URL('./.local/', import.meta.url), { recursive: true });
  await pentanaPage.screenshot({ path: fileURLToPath(new URL('./.local/current-screen.png', import.meta.url)) });
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      console.log(JSON.stringify({ title: await page.title(), origin: new URL(page.url()).origin }));
      for (const frame of page.frames()) {
        if (['modal', 'search-all'].includes(command) && !['guts', 'gutsHeader', 'action'].includes(frame.name())) continue;
        if (['modal', 'search-all'].includes(command) && frame !== page.frames().filter(f => f.name() === frame.name()).at(-1)) continue;
        if (command === 'inspect' || command === 'dom') {
          if (frameName && frameName !== '*' && frame.name() !== frameName) continue;
        } else if (!['modal', 'search-all'].includes(command) && !['gutsPage', 'action'].includes(frame.name())) continue;
        if (!await frame.locator('body').innerText({ timeout: 1000 }).catch(() => '')) continue;
        console.log(JSON.stringify(await frame.locator('body').evaluate(body => ({
          frameName: window.name,
          text: body.innerText.slice(0, 16000),
          tables: Array.from(body.querySelectorAll('table')).map(el => ({ id: el.id, rows: el.rows.length, text: el.innerText.slice(0, 200) })),
          controls: Array.from(body.querySelectorAll('button, input, select, a, iframe, img, [onclick]')).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').filter((el, i, elements) => elements.findIndex(other => other.tagName === el.tagName && other.id === el.id && other.getAttribute('title') === el.getAttribute('title')) === i).map(el => ({
            tag: el.tagName,
            type: el.getAttribute('type'),
            id: el.id,
            name: el.getAttribute('name'),
            selected: el.tagName === 'SELECT' ? Array.from(el.selectedOptions).map(o => ({ text: o.text, value: o.value })) : undefined,
            title: el.getAttribute('title'),
            alt: el.getAttribute('alt'),
            onclick: el.getAttribute('onclick')?.slice(0, 200),
            value: ['button', 'submit'].includes(el.getAttribute('type')) ? el.getAttribute('value') : undefined,
            label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 160),
          })),
        })), null, 2));
      }
    }
  }
} finally {
  await browser.close();
}
