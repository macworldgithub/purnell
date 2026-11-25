import { readFile, writeFile } from 'node:fs/promises';
import { parseCsv, toCsv } from './csv.mjs';
const output = 'exports/verification-2026-11-20';
const read = async path => parseCsv(await readFile(path, 'utf8')).records;
const changes = [];
const summary = {};
for (const [name, key] of [['open_repair_orders', 'ro number'], ['appointments', 'appt no']]) {
  const previous = await read('exports/followup-2026-11-12/' + name + '.csv');
  const current = await read(output + '/' + name + '.csv');
  const group = rows => {
    const result = new Map();
    for (const row of rows) {
      const id = name === 'appointments' ? JSON.stringify([row['appt no'], row['ro no'], row['serial no'], row['date in'], row['in']]) : row[key];
      if (!id?.trim()) continue;
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(row);
    }
    return result;
  };
  const old = group(previous);
  const now = group(current);
  const canonical = rows => rows.map(r => JSON.stringify(Object.entries(r).sort(([a],[b]) => a.localeCompare(b)))).sort().join('\n');
  const counts = { grouping: name === 'appointments' ? 'appointment number + RO number + serial + date/time in' : key, previous_detail_rows: previous.length, current_detail_rows: current.length, previous_records: old.size, current_records: now.size, new_records: 0, changed_records: 0, no_longer_listed: 0, unchanged: 0 };
  for (const [id, rows] of now) {
    if (!old.has(id)) {
      counts.new_records++;
      changes.push({ dataset: name, record_id: id, change: 'new', changed_fields: '' });
    } else if (canonical(rows) !== canonical(old.get(id))) {
      counts.changed_records++;
      const fields = [...new Set([...rows, ...old.get(id)].flatMap(Object.keys))].filter(field => JSON.stringify(rows.map(r => r[field]).sort()) !== JSON.stringify(old.get(id).map(r => r[field]).sort()));
      changes.push({ dataset: name, record_id: id, change: 'changed', changed_fields: fields.join('|') });
    } else counts.unchanged++;
  }
  for (const id of old.keys()) if (!now.has(id)) {
    counts.no_longer_listed++;
    changes.push({ dataset: name, record_id: id, change: 'no_longer_listed_in_report', changed_fields: '' });
  }
  summary[name] = counts;
}
const customers = await read('exports/followup-2026-11-12/customers.csv');
const vehicles = await read('exports/followup-2026-11-12/vehicles.csv');
const orders = await read(output + '/open_repair_orders.csv');
const appointments = await read(output + '/appointments.csv');
const oldCustomers = new Set(customers.map(r => r.customer_id));
const oldVehicles = new Set(vehicles.map(r => r.serial_no));
summary.references = {
  customers_outside_previous_master: [...new Set([...orders.map(r => r['customer id']), ...appointments.map(r => r.custno)].filter(v => v?.trim() && !oldCustomers.has(v)))].length,
  appointment_vehicles_outside_previous_master: [...new Set(appointments.map(r => r['serial no']).filter(v => v?.trim() && !oldVehicles.has(v)))].length,
};
await writeFile(output + '/changes.csv', toCsv(['dataset','record_id','change','changed_fields'], changes));
await writeFile(output + '/comparison.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
