import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { readFile, writeFile, mkdir, access, unlink, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const origin = 'https://c510778-erapower.pentana.cloud';
const local = new URL('./.local/', import.meta.url);
const blocked = new URL('login-blocked.json', local);
export async function handleKnownSerialWarning(page) {
  const warningFrame = page.frames().filter(item => item.name() === 'guts').at(-1);
  if (!warningFrame || !await warningFrame.locator('body').isVisible().catch(() => false)) return false;
  const warning = await warningFrame?.locator('body').innerText({ timeout: 500 }).catch(() => '');
  if (!/serial number/i.test(warning || '') || !/Do you wish to accept it/i.test(warning || '')) return false;
  const frame = page.frame({ name: 'gutsPage' });
  const serial = await frame?.locator('#SERINDEX_SerindexID, #txtSerialNo').first().inputValue().catch(() => '');
  const known = JSON.parse(await readFile(new URL('sync-known-records.json', local), 'utf8').catch(() => '{"vehicles":[]}'));
  if (!known.vehicles?.includes(serial?.trim())) throw new Error('Unrecognised serial validation prompt needs attention.');
  await page.frames().filter(item => item.name() === 'action').at(-1).getByText('Yes', { exact: true }).click();
  await delay(300);
  return true;
}
export async function ensureSession() {
  let browser;
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9337', { timeout: 3000 }); }
  catch {
    const launcher = spawn(process.execPath, [fileURLToPath(new URL('start-chrome.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('./', import.meta.url)), detached: true, windowsHide: true, stdio: 'ignore',
    });
    launcher.on('error', () => {});
    launcher.unref();
    for (let attempt = 0; attempt < 30 && !browser; attempt++) {
      await delay(1000);
      browser = await chromium.connectOverCDP('http://127.0.0.1:9337', { timeout: 1000 }).catch(() => null);
    }
    if (!browser) throw new Error('Could not open the dedicated eraPower browser.');
  }
  try {
    let page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith(origin + '/'));
    if (!page) {
      page = await browser.contexts()[0].newPage();
      await page.goto(origin + '/base/templates/vIndependent.htm', { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(500);
    const expired = await page.frames().filter(frame => frame.name() === 'guts').at(-1)?.locator('body').innerText({ timeout: 500 }).catch(() => '');
    if (/This session has become invalid and will be terminated/i.test(expired || '')) {
      await page.goto(origin + '/base/templates/vIndependent.htm', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(1000);
    }
    let frame;
    for (let attempt = 0; attempt < 40; attempt++) {
      frame = page.frame({ name: 'gutsPage' });
      if (frame && await frame.locator('body').count().catch(() => 0)) break;
      await delay(500);
    }
    if (!frame) throw new Error('eraPower screen unavailable.');
    await handleKnownSerialWarning(page);
    if (!await frame.locator('#password').isVisible().catch(() => false)) {
      await unlink(blocked).catch(() => {});
      return;
    }
    if (await access(blocked).then(() => true, () => false)) {
      const configTime = await stat(new URL('../../.env.erapower-login', import.meta.url)).then(info => info.mtimeMs, () => 0);
      const blockedTime = await stat(blocked).then(info => info.mtimeMs, () => Infinity);
      if (configTime > blockedTime) await unlink(blocked);
      else throw new Error('Automatic eraPower sign-in is paused after a rejected or incomplete login. Sign in manually or correct .env.erapower-login.');
    }
    let credentials;
    try {
      const config = dotenv.parse(await readFile(new URL('../../.env.erapower-login', import.meta.url), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      }));
      credentials = {
        username: process.env.ERAPOWER_USERNAME || config.ERAPOWER_USERNAME,
        password: process.env.ERAPOWER_PASSWORD || config.ERAPOWER_PASSWORD,
        workstation: process.env.ERAPOWER_WORKSTATION || config.ERAPOWER_WORKSTATION,
      };
    } catch { throw new Error('Could not read the local eraPower login configuration.'); }
    if (!credentials.username || !credentials.password) throw new Error('The saved eraPower login is incomplete.');
    const workstation = credentials.workstation;
    try {
      // The legacy login frame can be replaced once as the page finishes loading.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          frame = page.frame({ name: 'gutsPage' });
          await frame.locator('#user').waitFor({ state: 'visible', timeout: 5000 });
          await frame.locator('#user').fill(credentials.username);
          await frame.locator('#password').fill(credentials.password);
          break;
        } catch {
          if (attempt === 1) throw new Error('Login form unavailable');
          await delay(500);
        }
      }
    } catch {
      throw new Error('eraPower login fields could not be populated. Check the visible login screen.');
    } finally { credentials = null; }
    if (workstation) await frame.locator('#idLoginWorkstation').fill(workstation);
    // One submission per expired session. Unknown prompts require the user.
    await frame.locator('#Button52').click();
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const current = page.frame({ name: 'gutsPage' });
      const isLogin = await current?.locator('#password').isVisible().catch(() => false);
      const isMenu = await current?.getByText('Service', { exact: true }).isVisible().catch(() => false);
      const isServiceMenu = await current?.getByText('RO Costing', { exact: true }).isVisible().catch(() => false);
      if (!isLogin && (isMenu || isServiceMenu)) { console.log('eraPower automatic sign-in succeeded.'); return; }
      const message = await page.frames().filter(f => f.name() === 'guts').at(-1)?.locator('body').innerText({ timeout: 300 }).catch(() => '');
      if (message) break;
      await delay(500);
    }
    await mkdir(local, { recursive: true });
    await writeFile(blocked, JSON.stringify({ at: new Date().toISOString(), reason: 'Login did not reach the verified menu. Manual sign-in is required.' }));
    throw new Error('eraPower sign-in needs attention. Check credentials, MFA, workstation or the displayed prompt. Automatic retries are paused.');
  } finally { await browser.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await ensureSession().catch(error => { console.error(error.message); process.exitCode = 1; });
}
