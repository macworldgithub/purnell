import { readFile, writeFile, access, unlink, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { parseCsv, toCsv } from './pentana-export/csv.mjs';
import { writeVehicleCustomerLinks } from './erapower-linked-customers.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv.find(arg => arg.startsWith('--input='))?.slice(8);
if (!input) throw new Error('Supply --input=export-directory');
const output = resolve(input);
const exporter = join(project, 'tools', 'pentana-export');
const lock = join(project, 'logs', 'erapower-sync', 'running.lock');
if (await access(lock).then(() => true, () => false)) {
  const pid = Number(await readFile(lock, 'utf8'));
  try { process.kill(pid, 0); throw new Error('Wait for the running sync before final recovery'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  await unlink(lock);
}
const recoveryLock = await open(lock, 'wx');
await recoveryLock.writeFile(String(process.pid));
try {
const env = { ...process.env, ...dotenv.parse(await readFile(join(project, '.env.erapower-sync'))) };
const read = async name => parseCsv(await readFile(join(output, name + '.csv'), 'utf8')).records;
const manifestPath = join(output, 'full-sync-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
async function run(script, args, cwd = exporter) {
  const labels = {
    'scrape-vehicle-serials.mjs': 'Vehicle records',
    'scrape-vehicle-context.mjs': 'Vehicle warranty, contracts and comments',
    'scrape-history.mjs': 'Service history',
    'scrape-job-narratives.mjs': 'Repair job narratives',
    'scrape-records.mjs': 'Linked customer profiles',
    'scrape-followups.mjs': 'Customer follow-ups and warnings',
    'seed-erapower-current.mjs': 'Publishing validated records to MongoDB',
    'verify-erapower-refresh.mjs': 'Verifying CSV coverage and MongoDB contents',
    'scrape-sync-ancillary.mjs': 'Workshop, courtesy vehicles and lookup directories',
  };
  await writeFile(join(project, 'logs', 'erapower-sync', 'progress.json'), JSON.stringify({ runId: manifest.runId, startedAt: manifest.startedAt, stage: labels[script.split(/[\\/]/).at(-1)] || 'Data recovery', output, updatedAt: new Date().toISOString() }, null, 2));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('Recovery script failed')));
  });
}
async function capture(name, complete) {
  const bytes = await readFile(join(output, name + '.csv'));
  const item = { name, file: name + '.csv', rows: parseCsv(bytes.toString('utf8')).rows.length, complete, sha256: createHash('sha256').update(bytes).digest('hex') };
  manifest.datasets = manifest.datasets.filter(row => row.name !== name);
  manifest.datasets.push(item);
}
function resolveStage(stage, complete) {
  if (complete) manifest.failures = manifest.failures.filter(failure => failure.stage !== stage);
}
const ancillaryNames = ['workshop_status','workshop_status_codes','loan_car_status','fsa_advisors','customer_privacy_codes','service_department_options'];
let ancillary = JSON.parse(await readFile(join(output,'ancillary-status.json'),'utf8').catch(()=>'null'));
if (!ancillary?.exported || ancillary.failures.length || (await read('fsa_advisors').catch(()=>[])).length === 0 || (await read('customer_privacy_codes').catch(()=>[])).length === 0) {
  await run('scrape-sync-ancillary.mjs',[output]).catch(()=>{});
  ancillary = JSON.parse(await readFile(join(output,'ancillary-status.json'),'utf8'));
}
for (const name of ancillaryNames) {
  if (await access(join(output, name + '.csv')).then(() => true, () => false)) await capture(name, ancillary.exported?.includes(name) === true);
}
manifest.limitations = [...new Set([...manifest.limitations,...ancillary.limitations])];
resolveStage('Workshop and courtesy vehicles', ancillary.failures.length === 0);
await writeFile(manifestPath,JSON.stringify(manifest,null,2));
const vehicleIndex = await read('vehicle-lookup-index');
const expectedVehicles = new Set(vehicleIndex.map(row => row['serial no']).filter(Boolean));
let vehicles = await read('vehicles').catch(() => []);
if (vehicles.length < expectedVehicles.size) {
  await run('scrape-vehicle-serials.mjs', [output, join(output, 'vehicle-lookup-index.csv')]).catch(() => {});
  vehicles = await read('vehicles').catch(() => []);
}
await capture('vehicles', vehicles.length === expectedVehicles.size);
resolveStage('Vehicles', vehicles.length === expectedVehicles.size);
let contexts = await read('vehicle_service_customer_context').catch(() => []);
for (let attempt=0;attempt<2&&contexts.length<vehicles.length;attempt++) {
  await run('scrape-vehicle-context.mjs', [output, join(output, 'vehicles.csv')]).catch(() => {});
  contexts = await read('vehicle_service_customer_context').catch(() => []);
}
await capture('vehicle_service_customer_context', contexts.length === vehicles.length);
resolveStage('Vehicle warranty, contracts and comments', contexts.length === vehicles.length);
let summaries = await read('service_history_summary').catch(() => []);
if (summaries.length < vehicles.length) {
  await run('scrape-history.mjs', [output]).catch(() => {});
  summaries = await read('service_history_summary').catch(() => []);
}
for (const name of ['service_history','service_history_summary','history_customer_context']) await capture(name, summaries.length === vehicles.length);
resolveStage('Service history', summaries.length === vehicles.length);
const orders = await read('open_repair_orders');
const noteState = JSON.parse(await readFile(join(output, 'job-narratives-checkpoint.json'), 'utf8').catch(() => '{"completed_ros":[]}'));
if (!orders.every(row => noteState.completed_ros.includes(row['ro number']))) {
  await run('scrape-job-narratives.mjs', [output]).catch(() => {});
}
const jobs = await read('repair_order_jobs');
const notes = await read('repair_job_narratives').catch(() => []);
const noteKey = row => JSON.stringify([row.ro_number, row.job_index, row.operation_code?.trim()]);
const noteKeys = new Set(notes.map(noteKey));
const notesComplete = jobs.every(row => noteKeys.has(noteKey(row)));
await capture('repair_job_narratives', notesComplete);
resolveStage('Repair job narratives', notesComplete);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const originalIds = (await read('linked-record-index')).map(row => row['customer id']);
const links = await writeVehicleCustomerLinks(output);
await capture('vehicle_customer_links', links.complete);
const relatedIds = [];
relatedIds.push(...links.customerIds);
for (const name of ['vehicle_service_customer_context','history_customer_context']) {
  const rows = await read(name).catch(() => []);
  relatedIds.push(...rows.map(row => row.customer_id));
}
const ids = [...new Set([...originalIds, ...relatedIds].map(id => id?.trim()).filter(Boolean))];
await writeFile(join(output, 'linked-record-index.csv'), toCsv(['customer id'], ids.map(id => ({ 'customer id': id }))));
const knownPath = join(exporter, '.local', 'sync-known-records.json');
const known = JSON.parse(await readFile(knownPath, 'utf8'));
known.customers = [...new Set([...known.customers, ...ids])];
await writeFile(knownPath, JSON.stringify(known));
await run('scrape-records.mjs', ['--out', output]).catch(() => {});
const followupPath = join(output, 'followups-checkpoint.json');
const followupState = JSON.parse(await readFile(followupPath, 'utf8').catch(() => 'null'));
if (followupState) {
  const unverified = followupState.queries.filter(row => !/^context_verified/.test(row.status));
  const retryIds = new Set(unverified.map(row => row.customer_id));
  followupState.previous_unverified_queries = [...(followupState.previous_unverified_queries || []), ...unverified];
  followupState.queries = followupState.queries.filter(row => !retryIds.has(row.customer_id));
  followupState.completed_customers = followupState.completed_customers.filter(id => !retryIds.has(id));
  await writeFile(followupPath, JSON.stringify(followupState, null, 2));
}
await run('scrape-followups.mjs', [output]).catch(() => {});
const customers = await read('customers');
const found = new Set(customers.map(row => row.customer_id));
const unresolved = ids.filter(id => !found.has(id));
const queries = await read('followup_query_coverage').catch(() => []);
const checked = new Set(queries.filter(row => /^context_verified/.test(row.status)).map(row => row.customer_id));
const followupsComplete = !unresolved.length && ids.every(id => checked.has(id));
for (const [name, complete] of [
  ['customers', unresolved.length === 0],
  ['customer_followups', followupsComplete],
  ['customer_warnings', followupsComplete],
  ['followup_query_coverage', followupsComplete],
]) {
  const bytes = await readFile(join(output, name + '.csv')).catch(() => null);
  if (!bytes) continue;
  const item = { name, file: name + '.csv', rows: parseCsv(bytes.toString('utf8')).rows.length, complete, sha256: createHash('sha256').update(bytes).digest('hex') };
  manifest.datasets = manifest.datasets.filter(row => row.name !== name);
  manifest.datasets.push(item);
}
if (!unresolved.length) manifest.failures = manifest.failures.filter(failure => !['Customers', 'Additional linked customer profiles'].includes(failure.stage));
if (followupsComplete) manifest.failures = manifest.failures.filter(failure => failure.stage !== 'Customer follow-ups and warnings');
await writeFile(join(output, 'unresolved_customer_profiles.csv'), toCsv(['customer_id','status'], unresolved.map(customer_id => ({ customer_id, status: 'No verified profile returned by Service Entity Maintenance' }))));
manifest.recovery = { completedAt: new Date().toISOString(), customer_profiles: customers.length, expected_customer_ids: ids.length, unresolved_profiles: unresolved.length, followup_queries_verified: checked.size };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await run(join(project, 'tools', 'seed-erapower-current.mjs'), ['--input=' + output], project);
manifest.failures = manifest.failures.filter(failure => failure.stage !== 'Final verification');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await run(join(project, 'tools', 'verify-erapower-refresh.mjs'), ['--input=' + output], project).catch(() => {});
const verification = JSON.parse(await readFile(join(output, 'verification.json'), 'utf8'));
if (verification.issues.length) {
  manifest.failures.push({ stage: 'Final verification', error: 'See verification.json for unmatched records' });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
const result = JSON.parse(await readFile(join(output, 'mongodb-current-result.json'), 'utf8'));
const latestPath = join(project, 'logs', 'erapower-sync', 'latest.json');
const latest = JSON.parse(await readFile(latestPath, 'utf8').catch(() => 'null'));
const sameRun = latest?.runId === manifest.runId;
if (!latest || sameRun || (!latest.success && !latest.partial && !latest.result?.datasets?.length)) {
  const base = sameRun ? latest : { runId: manifest.runId, startedAt: manifest.startedAt, output };
  const totals = new Map((base.result?.datasets || []).map(item => [item.collection, item]));
  for (const item of result.datasets) {
    const prior = totals.get(item.collection);
    totals.set(item.collection, { ...item, new_rows: (prior?.new_rows || 0) + item.new_rows, updated_rows: (prior?.updated_rows || 0) + item.updated_rows });
  }
  await writeFile(latestPath, JSON.stringify({ ...base, completedAt: new Date().toISOString(), success: !manifest.failures.length, partial: !!manifest.failures.length, stage: manifest.failures.map(item => item.stage).join(', '), failures: manifest.failures, limitations: manifest.limitations, result: { datasets: [...totals.values()] }, metricsScope: base.metricsScope || (sameRun ? 'cumulative_saved_run' : 'latest_recovery_publication'), recovery: manifest.recovery }, null, 2));
}
console.log(JSON.stringify(manifest.recovery));
} finally {
  await recoveryLock.close();
  await unlink(lock);
}
