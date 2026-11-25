import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { parseCsv, toCsv } from './pentana-export/csv.mjs';
import { contentHash, recordKey, normalizeHeaders } from './erapower-sync-records.mjs';
import { reportNames } from './erapower-report-validation.mjs';

const arg = process.argv.find(value => value.startsWith('--input='))?.slice(8);
if (!arg) throw new Error('Supply --input=export-directory');
const folder = resolve(arg);
const manifest = JSON.parse(await readFile(join(folder, 'full-sync-manifest.json'), 'utf8'));
const result = { runId: manifest.runId, verifiedAt: new Date().toISOString(), datasets: [], coverage: [], issues: [], limitations: manifest.limitations };
const read = async name => parseCsv(await readFile(join(folder, name + '.csv'), 'utf8')).records;
const client = process.env.PURNELL_COPY_TARGET_URI ? new mongoose.mongo.MongoClient(process.env.PURNELL_COPY_TARGET_URI, { serverSelectionTimeoutMS: 12000 }) : null;
try {
  if (client) await client.connect();
  const db = client?.db('Purnell_Pentana_VoiceAgent');
  for (const item of manifest.datasets) {
    const bytes = await readFile(join(folder, item.file));
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
      result.issues.push(item.name + ': CSV changed since manifest validation');
      continue;
    }
    const csv = parseCsv(bytes.toString('utf8'));
    const fields = normalizeHeaders(csv.headers);
    const expected = new Map();
    for (const values of csv.rows) {
      const data = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
      const key = recordKey(item.name, data);
      const hash = contentHash(data);
      if (expected.has(key) && expected.get(key) !== hash) result.issues.push(item.name + ': conflicting source identity');
      expected.set(key, hash);
    }
    const check = { dataset: item.name, csv_rows: csv.rows.length, unique_records: expected.size, complete: item.complete, checksum_valid: true };
    if (db) {
      const collection=db.collection('erapower_current_' + item.name);
      const newer=reportNames.includes(item.name)&&await collection.findOne({observed_at:{$gt:manifest.startedAt},run_id:{$ne:manifest.runId}},{projection:{_id:1}});
      const docs = await collection.find({ _id: { $in: [...expected.keys()] } }).toArray();
      check.mongo_matching = docs.filter(doc => doc.content_hash === expected.get(doc._id) && contentHash(doc.data) === doc.content_hash && doc.listed_in_latest_report).length;
      check.mongo_same_snapshot = docs.filter(doc => doc.run_id === manifest.runId).length;
      check.superseded_by_newer_report=!!newer;
      if (!newer&&check.mongo_matching !== expected.size) result.issues.push(item.name + ': MongoDB content or listing differs from CSV');
      if (!newer&&check.mongo_same_snapshot !== expected.size) result.issues.push(item.name + ': MongoDB contains records from a different snapshot');
    }
    if (csv.rows.length !== item.rows) result.issues.push(item.name + ': manifest row count differs');
    result.datasets.push(check);
  }
  async function coverage(label, expectedRows, actualRows, expectedKey, actualKey = expectedKey, unavailable = new Set()) {
    const expected = new Set(expectedRows.map(expectedKey).filter(Boolean));
    const actual = new Set(actualRows.map(actualKey).filter(Boolean));
    const missingIds = [...expected].filter(key => !actual.has(key));
    const missing=missingIds.length;
    const sourceUnavailable=missingIds.filter(key=>unavailable.has(key)).length;
    result.coverage.push({ dataset: label, expected: expected.size, found: expected.size - missing, missing, source_unavailable:sourceUnavailable });
    if (missing>sourceUnavailable) result.issues.push(label + ': ' + (missing-sourceUnavailable) + ' required records missing without a source exception');
  }
  const ids = await read('linked-record-index');
  const vehicleIds = await read('vehicle-lookup-index');
  const customers = await read('customers').catch(() => []);
  const vehicles = await read('vehicles').catch(() => []);
  const unavailable=new Set((await read('vehicle_context_unavailable').catch(()=>[])).filter(row=>row.status==='source_record_locked').map(row=>row.serial_no));
  await coverage('customers', ids, customers, row => row['customer id'], row => row.customer_id);
  await coverage('vehicles', vehicleIds, vehicles, row => row['serial no'], row => row.serial_no);
  for (const dataset of ['vehicle_service_customer_context', 'service_history_summary', 'history_customer_context']) {
    await coverage(dataset, vehicleIds, await read(dataset).catch(() => []), row => row['serial no'], row => row.serial_no, dataset==='vehicle_service_customer_context'?unavailable:new Set());
  }
  const notes = await read('repair_job_narratives').catch(() => []);
  const jobs = await read('repair_order_jobs');
  const jobKey = row => JSON.stringify([row.ro_number, row.job_index, row.operation_code?.trim()]);
  const unavailableJobs=new Set((await read('repair_narrative_coverage').catch(()=>[])).filter(row=>row.status==='not_in_open_report_and_review_lookup_invalid').map(jobKey));
  await coverage('repair_job_narratives', jobs, notes, jobKey, jobKey, unavailableJobs);
  const queries = await read('followup_query_coverage').catch(() => []);
  await coverage('verified_customer_followup_queries', ids, queries.filter(row => /^context_verified/.test(row.status)), row => row['customer id'], row => row.customer_id);
  result.source_failures = manifest.failures;
  result.status = result.issues.length || manifest.failures.length ? 'partial' : 'verified_available_datasets';
  result.sourceLimited=result.coverage.some(row=>row.source_unavailable>0)||manifest.limitations.length>0;
  result.all_scope_requirements_complete=false;
  const coverageStatus = (...names) => names.every(name => manifest.datasets.some(item => item.name === name && item.complete) && !result.coverage.some(item => item.dataset === name && item.missing)) ? 'Exported for linked records' : 'Incomplete refresh';
  const scope = [
    ['Customer identity, names and contact details', coverageStatus('customers'), 'customers.csv', 'Source blanks retained. Coverage is the known linked set, not the entire dealership customer directory.'],
    ['Communication consent and suppression', 'Partial', 'customers.csv;customer_privacy_codes.csv', 'Raw privacy codes and definitions. Verified SMS consent and suppression records are not established.'],
    ['Authorised contacts and permissions to approve work', 'Unavailable in inspected screens', '', 'Customer/vehicle links do not establish permission to receive information or approve work.'],
    ['Vehicle registration, serial, make, model, year and colour', coverageStatus('vehicles'), 'vehicles.csv', 'Source serial_no is not guaranteed to be a valid 17-character VIN.'],
    ['Customer and vehicle associations', coverageStatus('vehicle_customer_links'), 'vehicle_customer_links.csv;vehicle_service_customer_context.csv;history_customer_context.csv', 'Link sources distinguish report references, maintenance customer and history-screen customer. These associations are not authorisation to disclose information or approve work.'],
    ['Assigned service advisor and sales contact', 'Partial', 'open_repair_orders.csv;staff_advisors.csv;vehicle_service_customer_context.csv', 'RO advisor and source salesman ID where populated. Current assignments are not independently verified.'],
    ['Repair orders, job concerns and workshop stage', coverageStatus('repair_order_details', 'repair_order_jobs', 'repair_job_narratives'), 'open_repair_orders.csv;repair_order_details.csv;repair_order_jobs.csv;repair_job_narratives.csv;workshop_status.csv', 'Raw source statuses and dates. Promised dates are not independently confirmed completion estimates.'],
    ['Ready-for-collection flag and confirmed collection time', 'Unverified', '', 'Vehicle delivery dates and promised repair dates do not establish collection readiness.'],
    ['Courtesy vehicles', coverageStatus('loan_car_status'), 'loan_car_status.csv', 'Limited to the report filters recorded in loan_car_status.manifest.json.'],
    ['Parts orders, lines, quantities, status, ETA and receipts', 'Access unavailable', '', 'Parts Requests denied this account or is unavailable in its configuration. No parts-arrival monitoring data obtained.'],
    ['Existing appointments', coverageStatus('appointments'), 'appointments.csv', 'Detail lines, not a count of distinct bookings. Report dates are recorded in the source manifest.'],
    ['Genuine available booking slots by franchise/advisor/job', 'Unverified', 'appointment_capacity_totals.csv', 'Aggregate capacity is not a list of bookable slots.'],
    ['Service history and recorded mileage', coverageStatus('service_history_summary', 'service_history'), 'service_history.csv;service_history_summary.csv;vehicle_service_customer_context.csv', 'All linked vehicles require a verified history query, including vehicles with no rows. The last RO date is not necessarily the last scheduled service.'],
    ['Warranty coverage, contracts and vehicle comments', coverageStatus('vehicle_service_customer_context'), 'vehicle_service_customer_context.csv', 'Coverage and contracts are not proof of an open warranty claim or campaign. Blank VIP fields are unknown, not false.'],
    ['Complaints, callback flags, owner and promised callback time', 'Partial or unverified', 'customer_followups.csv;customer_warnings.csv;followup_query_coverage.csv', 'Raw notes/warnings only where returned. An unverified customer context is not an empty result.'],
    ['Customer-since date, last purchase and sales assignment', 'Partial', 'vehicle_service_customer_context.csv', 'Source delivery dates and salesman ID do not establish customer-since or last purchase.'],
    ['Staff directory, roles, departments, queues and extensions', 'Partial', 'staff_advisors.csv;fsa_advisors.csv', 'Selector entries are not the full staff directory. 3CX routing and live availability are outside this eraPower export.'],
  ].map(([requirement, status, files, notes]) => ({ requirement, status, files, notes }));
  await writeFile(join(folder, 'scope_coverage.csv'), toCsv(['requirement', 'status', 'files', 'notes'], scope));
  await writeFile(join(folder, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (result.issues.length) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ error: error.name, code: error.code ?? null }));
  process.exitCode = 1;
} finally { await client?.close(); }
