import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, serviceMenu, clickText, visibleLocator, until, metadata } from './pentana-ui.mjs';

// Inspect and operate only the signed-in Pentana tab. Never print record values.
const [command = 'snapshot', ...args] = process.argv.slice(2);
const { browser, page } = await connect();
try {
  if (command === 'route') {
    await serviceMenu(page);
    for (const item of args) {
      const before = await page.frame({ name: 'gutsPage' }).locator('body').innerText();
      await clickText(page, 'gutsPage', item);
      await until(async () => await page.frame({ name: 'gutsPage' })?.locator('body').innerText({ timeout: 500 }).catch(() => '') !== before ||
        await page.frames().filter(f => f.name() === 'guts').at(-1)?.locator('body').innerText({ timeout: 500 }).catch(() => ''), item);
    }
  } else if (command === 'click') {
    await clickText(page, args[0], args[1]);
  } else if (command === 'fill') {
    const locator = await visibleLocator(page, args[0], args[1]);
    await locator.fill(args[2]);
    await locator.press('Tab');
  } else if (command === 'select') {
    const locator = await visibleLocator(page, args[0], args[1]);
    await locator.selectOption({ label: args[2] });
    await locator.press('Tab');
  } else if (command === 'dom') {
    const locator = await visibleLocator(page, args[0], args[1]);
    console.log(await locator.evaluate(e => e.outerHTML));
  }
  await mkdir(new URL('./.local/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('./.local/current-screen.png', import.meta.url)) });
  const data = await metadata(page);
  await writeFile(new URL('./.local/current-metadata.json', import.meta.url), JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ title: data.title, frames: data.frames.map(f => ({
    name: f.name, text: f.text.slice(0, 2400), tables: f.tables,
    controls: f.controls.filter(c => c.tag !== 'IMG' && !c.id?.startsWith('searchresults')).slice(0, 65),
  })) }));
} finally { await browser.close(); }
