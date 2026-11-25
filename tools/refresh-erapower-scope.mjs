import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseCsv, toCsv } from './pentana-export/csv.mjs';
import { writeVehicleCustomerLinks } from './erapower-linked-customers.mjs';

export async function refreshScope({ output, exporter, run, env, progress, runId, startedAt, publish }) {
  await mkdir(output, { recursive: true });
  const manifest = { runId, startedAt, datasets: [], limitations: [
    'Coverage includes the known linked customer/vehicle set and records referenced by current reports.',
    'Parts orders/receipts require an eraPower account with read access.',
    'Authorised contacts, verified SMS consent, collection confirmation and bookable slots remain dependent on source exposure.',
  ], failures: [] };
  const read = async name => parseCsv(await readFile(join(output, name + '.csv'), 'utf8')).records;
  const save = () => writeFile(join(output, 'full-sync-manifest.json'), JSON.stringify(manifest, null, 2));
  async function capture(name, complete) {
    const bytes = await readFile(join(output, name + '.csv'));
    const parsed = parseCsv(bytes.toString('utf8'));
    manifest.datasets = manifest.datasets.filter(item => item.name !== name);
    manifest.datasets.push({ name, file: name + '.csv', rows: parsed.rows.length, complete, sha256: createHash('sha256').update(bytes).digest('hex') });
    await save();
  }
  async function stage(name, action) {
    await progress(name);
    try { await action(); }
    catch (error) { manifest.failures.push({ stage: name, error: error.message }); await save(); }
    if (manifest.datasets.length && publish) await publish();
  }
  async function scrape(script, args, check) {
    let complete = false;
    for (let attempt = 0; attempt < 2 && !complete; attempt++) {
      await run(script, args, exporter, env).catch(() => {});
      complete = await check().catch(() => false);
    }
    return complete;
  }
  await stage('Reports', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await run('export-pentana.mjs', ['--only', 'open_repair_orders,appointments,status_codes',
          '--from', '01/01/2025', '--to', '31/12/' + (new Date().getFullYear() + 1), '--out', output], exporter, env);
        break;
      } catch (error) { if (attempt === 1) throw error; }
    }
    const report = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    for (const item of report.datasets.filter(item => item.status === 'exported')) await capture(item.name, true);
  });
  // Current report files are required for safe linked-record resolution.
  const orders = await read('open_repair_orders');
  const appointments = await read('appointments');
  await stage('Repair order details and jobs', async () => {
    const complete = await scrape('scrape-repair-report.mjs', [output], async () => {
      const state = JSON.parse(await readFile(join(output, 'repair-report-checkpoint.json'), 'utf8'));
      return orders.every(row => state.completed_ids.includes(row['ro number']));
    });
    for (const name of ['repair_order_details', 'repair_order_jobs']) await capture(name, complete);
    if (!complete) throw new Error('Repair details have unresolved references');
  });
  await stage('Repair job narratives', async () => {
    const complete = await scrape('scrape-job-narratives.mjs', [output], async () => {
      const state = JSON.parse(await readFile(join(output, 'job-narratives-checkpoint.json'), 'utf8'));
      return orders.every(row => state.completed_ros.includes(row['ro number']));
    });
    await capture('repair_job_narratives', complete);
    if (!complete) throw new Error('Record-level coverage incomplete');
  });
  const priorFolder = join(exporter, 'exports', 'followup-2026-11-12');
  const oldCustomers = parseCsv(await readFile(join(priorFolder, 'customers.csv'), 'utf8')).records;
  const oldVehicles = parseCsv(await readFile(join(priorFolder, 'vehicles.csv'), 'utf8')).records;
  const priorKnown = JSON.parse(await readFile(join(exporter, '.local', 'sync-known-records.json'), 'utf8').catch(() => '{"customers":[],"vehicles":[]}'));
  const details = await read('repair_order_details').catch(() => []);
  const customerIds = [...new Set([...oldCustomers.map(row => row.customer_id), ...priorKnown.customers,
    ...orders.map(row => row['customer id']), ...appointments.map(row => row.custno)].filter(Boolean))];
  const serials = [...new Set([...oldVehicles.map(row => row.serial_no), ...priorKnown.vehicles,
    ...details.map(row => row.serial_no), ...appointments.map(row => row['serial no'])].filter(Boolean))];
  await mkdir(join(exporter, '.local'), { recursive: true });
  await writeFile(join(exporter, '.local', 'sync-known-records.json'), JSON.stringify({ customers: customerIds, vehicles: serials }));
  await writeFile(join(output, 'linked-record-index.csv'), toCsv(['customer id'], customerIds.map(id => ({ 'customer id': id }))));
  const vehicleIndex = [
    ...appointments.map(row => ({ 'serial no': row['serial no'], 'rego no': row['rego no'], custno: row.custno })),
    ...details.map(row => ({ 'serial no': row.serial_no, 'rego no': row.registration, custno: row.customer_id })),
    ...oldVehicles.map(row => ({ 'serial no': row.serial_no, 'rego no': row.registration, custno: row.customer_ids })),
    ...serials.map(serial => ({ 'serial no': serial, 'rego no': '', custno: '' })),
  ];
  await writeFile(join(output, 'vehicle-lookup-index.csv'), toCsv(['serial no','rego no','custno'], vehicleIndex));
  await writeFile(join(output, 'vehicles-checkpoint.json'), JSON.stringify({ records: [], completed_ids: [], failures: [] }));
  await stage('Customers', async () => {
    const complete = await scrape('scrape-records.mjs', ['--out', output], async () => (await read('customers')).length === customerIds.length);
    await capture('customers', complete);
    if (!complete) throw new Error('Some customer profiles could not be read');
  });
  await stage('Vehicles', async () => {
    const complete = await scrape('scrape-vehicle-serials.mjs', [output, join(output, 'vehicle-lookup-index.csv')],
      async () => (await read('vehicles')).length === serials.length);
    await capture('vehicles', complete);
    if (!complete) throw new Error('Some vehicle profiles could not be read');
  });
  for (const job of [
    { stage: 'Vehicle warranty, contracts and comments', script: 'scrape-vehicle-context.mjs', args: [output, join(output, 'vehicles.csv')], file: 'vehicle_service_customer_context', check: async () => (await read('vehicle_service_customer_context')).length === (await read('vehicles')).length },
    { stage: 'Service history', script: 'scrape-history.mjs', args: [output], file: 'service_history', extra: ['service_history_summary', 'history_customer_context'], check: async () => (await read('service_history_summary')).length === (await read('vehicles')).length },
    { stage: 'Customer follow-ups and warnings', script: 'scrape-followups.mjs', args: [output], file: 'customer_followups', extra: ['customer_warnings','followup_query_coverage'], check: async () => {
      const verified = new Set((await read('followup_query_coverage')).filter(row => /^context_verified/.test(row.status)).map(row => row.customer_id));
      return customerIds.every(id => verified.has(id));
    } },
  ]) {
    if (job.file === 'customer_followups') await stage('Additional linked customer profiles', async () => {
      const links = await writeVehicleCustomerLinks(output);
      await capture('vehicle_customer_links', links.complete);
      const related = [...await read('vehicle_service_customer_context').catch(() => []), ...await read('history_customer_context').catch(() => [])];
      const newIds = [...new Set([...links.customerIds, ...related.map(row => row.customer_id?.trim()).filter(Boolean)])].filter(id => !customerIds.includes(id));
      if (!newIds.length) return;
      customerIds.push(...newIds);
      await writeFile(join(output, 'linked-record-index.csv'), toCsv(['customer id'], customerIds.map(id => ({ 'customer id': id }))));
      await writeFile(join(exporter, '.local', 'sync-known-records.json'), JSON.stringify({ customers: customerIds, vehicles: serials }));
      const complete = await scrape('scrape-records.mjs', ['--out', output], async () => {
        const found = new Set((await read('customers')).map(row => row.customer_id));
        return customerIds.every(id => found.has(id));
      });
      await capture('customers', complete);
      if (!complete) throw new Error('Some linked customer profiles could not be read');
    });
    await stage(job.stage, async () => {
    const complete = await scrape(job.script, job.args, job.check);
    for (const name of [job.file, ...(job.extra || [])]) await capture(name, complete);
    if (!complete) throw new Error('Record-level coverage incomplete');
    });
  }
  await stage('Workshop and courtesy vehicles', async () => {
    await run('scrape-sync-ancillary.mjs', [output], exporter, env).catch(() => {});
    const ancillary = JSON.parse(await readFile(join(output, 'ancillary-status.json'), 'utf8'));
    for (const name of ['workshop_status', 'workshop_status_codes', 'loan_car_status','fsa_advisors','customer_privacy_codes','service_department_options']) {
      await capture(name, ancillary.exported?.includes(name) === true).catch(() => {});
    }
    manifest.limitations.push(...ancillary.limitations);
    if (ancillary.failures.length) throw new Error(ancillary.failures.map(item => item.stage).join(', ') + ' could not be refreshed');
  });
  await save();
  return manifest;
}
