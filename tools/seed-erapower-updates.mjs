import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { parseCsv } from './pentana-export/csv.mjs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const input = process.argv.find(arg => arg.startsWith('--input='))?.slice(8);
const root = input ? pathToFileURL(resolve(input) + '/') : new URL('./pentana-export/exports/verification-2026-11-20/', import.meta.url);
const snapshot = input ? basename(resolve(input)) : '2026-11-20';
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const uri = process.env.PURNELL_COPY_TARGET_URI;
if (!uri) throw new Error('PURNELL_COPY_TARGET_URI is required');
const canonical = data => JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
const hash = text => createHash('sha256').update(text).digest('hex');
const fieldsFor = headers => headers.map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
function identity(name, data) {
  if (name === 'open_repair_orders') return data.ro_number?.trim();
  if (name === 'staff_advisors') return data.advisor_id?.trim();
  if (name === 'appointment_capacity_totals') return JSON.stringify([data.from_date, data.to_date, data.department_id, data.advisor_id]);
  if (name === 'appointments') {
    const booking = data.appt_no?.trim();
    const order = data.ro_no?.trim();
    if (!booking && !order) throw new Error('Appointment lacks booking and repair order keys');
    return JSON.stringify([booking, order, data.serial_no, data.date_in, data.in, data.op_codes, data.s_t]);
  }
  return canonical(data);
}
const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000 });
let stage = 'connect';
try {
  await client.connect();
  const db = client.db('Purnell_Pentana_VoiceAgent');
  const report = { apply: process.argv.includes('--apply'), datasets: [] };
  for (const dataset of manifest.datasets.filter(d => d.status === 'exported' && d.file)) {
    stage = dataset.name;
    const bytes = await readFile(new URL(dataset.file, root));
    const parsed = parseCsv(bytes.toString('utf8'));
    if (dataset.sha256 && hash(bytes) !== dataset.sha256) throw new Error('CSV checksum mismatch');
    if (parsed.rows.length !== dataset.rows) throw new Error('CSV count mismatch');
    const fields = fieldsFor(parsed.headers);
    if (new Set(fields).size !== fields.length || fields.some(f => !f)) throw new Error('Ambiguous normalized headers');
    const name = dataset.name;
    const collection = db.collection('erapower_' + name);
    const before = await collection.find().toArray();
    const existing = new Map();
    for (const document of before) {
      if (!document.data) continue;
      const key = identity(name, document.data);
      if (!key) throw new Error('Existing row lacks business identity');
      if (!existing.has(key)) existing.set(key, []);
      existing.get(key).push(document.data);
    }
    const pending = [];
    const seen = new Set();
    let alreadyPresent = 0;
    let changedExisting = 0;
    let repeatedInCsv = 0;
    parsed.rows.forEach((values, i) => {
      const data = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
      const key = identity(name, data);
      if (!key) throw new Error('Source row lacks business identity');
      if (seen.has(key)) { repeatedInCsv++; return; }
      seen.add(key);
      if (existing.has(key)) {
        alreadyPresent++;
        if (!existing.get(key).some(old => canonical(old) === canonical(data))) changedExisting++;
        return;
      }
      pending.push({
        _id: 'business/' + hash(key),
        source_file: snapshot + '/' + dataset.file,
        row_number: i + 1,
        data,
      });
    });
    if (report.apply && pending.length) {
      await collection.bulkWrite(pending.map(document => ({
        updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true },
      })));
      const copied = await collection.find({ _id: { $in: pending.map(row => row._id) } }).toArray();
      const expected = new Map(pending.map(row => [row._id, canonical(row.data)]));
      if (copied.length !== pending.length || copied.some(row => expected.get(row._id) !== canonical(row.data))) throw new Error('Inserted rows failed verification');
    }
    if (report.apply) {
      const after = await collection.find({ _id: { $in: before.map(row => row._id) } }).toArray();
      const prior = new Map(before.map(row => [String(row._id), canonical(row)]));
      if (after.length !== before.length || after.some(row => prior.get(String(row._id)) !== canonical(row))) throw new Error('An existing document changed');
    }
    report.datasets.push({ collection: collection.collectionName, source_rows: parsed.rows.length, new_rows: pending.length, already_present: alreadyPresent, changed_existing_skipped: changedExisting, repeated_source_keys: repeatedInCsv });
  }
  await writeFile(new URL(report.apply ? 'mongodb-insert-only-result.json' : 'mongodb-insert-only-plan.json', root), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({ stage, error: error.name, code: error.code ?? null, reason: /CSV|identity|verification|changed|Appointment|headers/.test(error.message) ? error.message : undefined }));
  process.exitCode = 1;
} finally {
  await client.close();
}
