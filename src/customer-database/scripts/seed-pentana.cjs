const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
require('dotenv').config({ quiet: true });

const folder = path.resolve(process.argv[2] || '../pentana-csv-2026-10-26');
const snapshot = '2026-10-26';
const files = {};
for (const name of fs.readdirSync(folder).filter(n => n.endsWith('.csv'))) {
  const bytes = fs.readFileSync(path.join(folder, name));
  const rows = [];
  let row = [], value = '', quoted = false;
  const source = bytes.toString('utf8').replace(/^\uFEFF/, '') + '\n';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n' || ch === '\r')) {
      row.push(value); value = '';
      if (ch !== ',') {
        if (row.length > 1 || row[0]) rows.push(row);
        row = [];
        if (ch === '\r' && source[i + 1] === '\n') i++;
      }
    } else value += ch;
  }
  const header = rows.shift();
  if (quoted || !header || new Set(header).size !== header.length ||
      rows.some(r => r.length !== header.length)) throw Error('Malformed CSV: ' + name);
  files[name] = { hash: createHash('sha256').update(bytes).digest('hex'),
    rows: rows.map(r => Object.fromEntries(header.map((key, i) => [key, r[i]]))) };
}
const rows = name => files[name + '.csv'].rows;
for (const r of rows('export_summary')) {
  if (files[r.file]?.hash !== r.sha256 || files[r.file].rows.length !== Number(r.rows))
    throw Error('Export checksum or count mismatch: ' + r.file);
}
const plate = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const phone = s => {
  const digits = (s || '').replace(/\D/g, '');
  if (/^0[23478]\d{8}$/.test(digits)) return '+61' + digits.slice(1);
  return /^61[23478]\d{8}$/.test(digits) ? '+' + digits : undefined;
};
const group = (items, key) => {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
};
const bySerial = new Map(rows('vehicles').map(v => [v.serial_no, v]));
const byCustomer = group(rows('vehicles').flatMap(v => {
  const ids = [...new Set(v.customer_ids.split('|').map(s => s.trim()).filter(Boolean))];
  // Report references with multiple customers do not establish current ownership.
  return ids.length === 1 ? [{ id: ids[0], v }] : [];
}), r => r.id);
const jobs = group(rows('repair_order_jobs'), r => r.ro_number);
const workshop = group(rows('workshop_status'), r => r['ro no']);
const customers = rows('customers').map(r => ({
  customer_id: r.customer_id, customer_name: r.full_name || r.business_name,
  preferred_name: r.preferred_name || undefined, mobile: phone(r.mobile),
  landline: phone(r.home_phone), email: r.email || undefined,
  consent_sms: false, consent_marketing: false,
  vehicles: (byCustomer.get(r.customer_id) || []).filter(({v}) => plate(v.registration))
    .map(({v}) => ({ rego: plate(v.registration), serial_no: v.serial_no,
      year: /^\d{4}$/.test(v.year) ? Number(v.year) : undefined,
      make: v.make, model: v.model_description, colour: v.colour })),
}));
const repairorders = rows('repair_order_details').map(r => ({
  ro_number: r.ro_number, customer_id: r.customer_id,
  vehicle_rego: plate(bySerial.get(r.serial_no)?.registration || r.registration) || undefined,
  vehicle_serial_no: r.serial_no, advisor: r.advisor_name, drop_off_date: r.date_in,
  drop_off_time: r.time_in, promised_date: r.promised_date, promised_time: r.promised_time,
  status: workshop.get(r.ro_number)?.find(w => w.status)?.status || r.ro_status,
  job_lines: (jobs.get(r.ro_number) || []).map(j => ({
    line_id: Number(j.job_index), description: j.operation_code, status: j.status,
  })),
}));
const appointmentRows = rows('appointments').filter(r => r['appt no'].trim() && !/^0+$/.test(r['appt no'].trim()));
const servicebookings = [...group(appointmentRows, r =>
  JSON.stringify([r['appt no'], r.custno, r['serial no'], r['date in'], r.in])
).values()].map(items => {
  const r = items[0];
  return { booking_id: ['pentana', r['appt no'], r.custno, r['serial no'], r['date in'], r.in].join(':'),
    pentana_appointment_no: r['appt no'], customer_id: r.custno,
    vehicle_rego: plate(bySerial.get(r['serial no'])?.registration || r['rego no']) || undefined,
    vehicle_serial_no: r['serial no'], date: r['date in'], time: r.in, advisor: r.advisor,
    job_type: [...new Set(items.map(x => x['op code description']).filter(Boolean))].join('; ') };
});
const collections = [
  ['customers', 'customer_id', customers],
  ['repairorders', 'ro_number', repairorders],
  ['servicebookings', 'booking_id', servicebookings],
  ...Object.entries(files).map(([name, file]) => [
    name === 'service_history.csv' ? 'servicehistory' : 'pentana_' + path.basename(name, '.csv'),
    '_id', file.rows.map((r, i) => ({ ...r, _id: snapshot + ':' + (i + 1) })),
  ]),
];
for (const [name, key, docs] of collections) {
  if (docs.some(r => !r[key]) || new Set(docs.map(r => r[key])).size !== docs.length)
    throw Error('Missing or duplicate import key: ' + name);
}
const ids = new Set(customers.map(r => r.customer_id));
if ([...repairorders, ...servicebookings].some(r => !ids.has(r.customer_id) || !bySerial.has(r.vehicle_serial_no)))
  throw Error('Unresolved customer or vehicle link');
console.log(JSON.stringify({ csvFiles: Object.keys(files).length, csvRows: Object.values(files).reduce((n,f) => n + f.rows.length, 0),
  customers: customers.length, repairOrders: repairorders.length, appointments: servicebookings.length }));
if (!process.argv.includes('--write')) return;

(async () => {
  try {
    if (!process.env.MONGO_URI) throw Error('Missing database configuration');
    const dbName = process.env.MONGO_DB_NAME || 'Purnell_Pentana_VoiceAgent';
    await mongoose.connect(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 6000 });
    console.log('Database: ' + mongoose.connection.name);
    for (const [name, key, docs] of collections) {
      const c = mongoose.connection.collection(name);
      if (!docs.length) {
        console.log(name + ': no source rows');
        continue;
      }
      for (let i = 0; i < docs.length; i += 500) {
        await c.bulkWrite(docs.slice(i, i + 500).map(doc => {
          const fields = Object.fromEntries(Object.entries(doc).filter(([k,v]) => k !== '_id' && v !== undefined));
          return { updateOne: { filter: { [key]: doc[key] },
            update: { $set: { ...fields, pentana_snapshot: snapshot } }, upsert: true } };
        }));
      }
      const count = await c.countDocuments({ pentana_snapshot: snapshot, [key]: { $in: docs.map(r => r[key]) } });
      if (count !== docs.length) throw Error('Database count mismatch: ' + name);
      console.log(name + ': ' + count + ' verified');
    }
  } catch (e) {
    console.error('Pentana import failed:', e.name, e.code || '');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
