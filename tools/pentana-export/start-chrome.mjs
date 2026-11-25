import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const portal = 'https://c510778-erapower.pentana.cloud/base/templates/vIndependent.htm';
const profile = fileURLToPath(new URL('./.local/chrome-profile', import.meta.url));
const port = 9337;

// Keep the dealership session separate from the user's everyday Chrome profile.
// Login is completed by the user; the script never reads login field values.
await mkdir(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  acceptDownloads: true,
  viewport: null,
  args: [
    '--start-maximized',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
  ],
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto(portal, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log(`Pentana Chrome is open. Playwright endpoint: http://127.0.0.1:${port}`);
console.log('Sign in to Pentana in this window. No records have been exported yet.');
await new Promise(resolve => context.once('close', resolve));
