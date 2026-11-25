import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv, toCsv } from './csv.mjs';

const folder = process.argv[2];
if (!folder) throw new Error('Supply the follow-up export directory');
const read = async name => parseCsv(await readFile(join(folder, name + '.csv'), 'utf8')).records;
const [orders, details, jobs, appointments, customers, vehicles] = await Promise.all(
  ['open_repair_orders', 'repair_order_details', 'repair_order_jobs', 'appointments', 'customers', 'vehicles'].map(read),
);
const keys = (rows, field) => new Set(rows.map(row => row[field]?.trim()).filter(Boolean));
const missing = (rows, field, master, key) => {
  const available = keys(master, key);
  return [...keys(rows, field)].filter(value => !available.has(value));
};
const checks = [
  ['open_order_details', missing(orders, 'ro number', details, 'ro_number')],
  ['open_order_customers', missing(orders, 'customer id', customers, 'customer_id')],
  ['repair_detail_vehicles', missing(details, 'serial_no', vehicles, 'serial_no')],
  ['appointment_customers', missing(appointments, 'custno', customers, 'customer_id')],
  ['appointment_vehicles', missing(appointments, 'serial no', vehicles, 'serial_no')],
  ['job_repair_orders', missing(jobs, 'ro_number', details, 'ro_number')],
];
for (const [rows, field] of [[customers, 'customer_id'], [vehicles, 'serial_no'], [details, 'ro_number']]) {
  if (keys(rows, field).size !== rows.length) throw new Error('Missing or duplicate key in ' + field);
}
const summary = {
  open_orders: orders.length,
  repair_details: details.length,
  job_rows: jobs.length,
  appointment_detail_rows: appointments.length,
  customer_profiles: customers.length,
  vehicles: vehicles.length,
  unmatched_distinct_nonblank_keys: Object.fromEntries(checks.map(([label, ids]) => [label, ids.length])),
  parts_requests: 'Pentana explicitly denied access to the signed-in account.',
  consent_and_suppression: 'Customer privacy codes are present where recorded. Authoritative SMS consent and suppression were not verified.',
  availability_and_routing: 'Appointment reports do not establish bookable slots. Advisor IDs and names do not establish 3CX queue or extension mappings.',
  scope: 'November reports with new details for missing links and matching October records reused. This is not a full dealership extract or live integration.',
};
await writeFile(join(folder, 'coverage.json'), JSON.stringify(summary, null, 2));
await writeFile(join(folder, 'unmatched_links.csv'), toCsv(['check', 'source_key'],
  checks.flatMap(([check, ids]) => ids.map(source_key => ({ check, source_key })))));
console.log(JSON.stringify(summary));
