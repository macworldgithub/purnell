import { spawn } from 'node:child_process';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { refreshScope } from './refresh-erapower-scope.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const exporter = join(project, 'tools', 'pentana-export');
const logs = join(project, 'logs', 'erapower-sync');
await mkdir(logs, { recursive: true });
const lockPath = join(logs, 'running.lock');
let lock;
try {
  lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const pid = Number(await readFile(lockPath, 'utf8'));
  try { process.kill(pid, 0); process.exit(0); }
  catch (check) { if (check.code !== 'ESRCH') throw check; }
  await unlink(lockPath);
  lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const startedAt = new Date().toISOString();
console.log('eraPower sync started at ' + new Date(startedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) + ' Australia/Sydney');
const output = join(exporter, 'exports', 'scheduled-' + runId);
const log = [];
function run(script, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Sync stage exceeded 100 minutes')); }, 100 * 60 * 1000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => log.push(chunk.toString()));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Sync stage failed: ' + script)); });
  });
}
let stage = 'configuration';
async function progress(name) {
  stage = name;
  console.log('eraPower sync stage: ' + name);
  await writeFile(join(logs, 'progress.json'), JSON.stringify({ runId, startedAt, stage, output, updatedAt: new Date().toISOString() }, null, 2));
}
try {
  const config = dotenv.parse(await readFile(join(project, '.env.erapower-sync')));
  if (!config.PURNELL_COPY_TARGET_URI) throw new Error('Sync MongoDB configuration missing');
  const env = { ...process.env, ...config };
  await progress('eraPower session and sign-in');
  await run('ensure-session.mjs', [], exporter, env);
  const totals = new Map();
  async function publish() {
    await progress('Publishing validated records to MongoDB');
    await run(join(project, 'tools', 'seed-erapower-current.mjs'), ['--input=' + output], project, env);
    const latest = JSON.parse(await readFile(join(output, 'mongodb-current-result.json'), 'utf8'));
    for (const item of latest.datasets) {
      const prior = totals.get(item.collection);
      totals.set(item.collection, { ...item, new_rows: (prior?.new_rows || 0) + item.new_rows, updated_rows: (prior?.updated_rows || 0) + item.updated_rows });
    }
    await writeFile(join(logs, 'published-progress.json'), JSON.stringify({ runId, updatedAt: new Date().toISOString(), datasets: [...totals.values()] }, null, 2));
  }
  const manifest = await refreshScope({ output, exporter, run, env, progress, runId, startedAt, publish });
  await publish();
  await progress('Verifying CSV coverage and MongoDB contents');
  try {
    await run(join(project, 'tools', 'verify-erapower-refresh.mjs'), ['--input=' + output], project, env);
  } catch {
    manifest.failures.push({ stage: 'Final verification', error: 'See verification.json for unmatched source records or MongoDB differences' });
    await writeFile(join(output, 'full-sync-manifest.json'), JSON.stringify(manifest, null, 2));
  }
  const result = { datasets: [...totals.values()] };
  const completedAt = new Date().toISOString();
  await writeFile(join(logs, 'latest.json'), JSON.stringify({ runId, startedAt, completedAt, success: manifest.failures.length === 0, partial: manifest.failures.length > 0, stage: manifest.failures.map(f => f.stage).join(', '), failures: manifest.failures, limitations: manifest.limitations, output, result }, null, 2));
  if (manifest.failures.length) process.exitCode = 2;
  console.log('eraPower sync completed at ' + new Date(completedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) + ' Australia/Sydney');
} catch (error) {
  await writeFile(join(logs, 'latest.json'), JSON.stringify({ runId, startedAt, completedAt: new Date().toISOString(), success: false, stage, message: error.message, output }, null, 2));
  console.error('eraPower sync failed during ' + stage + '. See logs/erapower-sync/latest.json');
  process.exitCode = 1;
} finally {
  await writeFile(join(logs, runId + '.log'), log.join(''));
  await lock.close();
  await unlink(lockPath);
}
