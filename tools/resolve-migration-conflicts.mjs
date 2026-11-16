import mongoose from 'mongoose';
import { isDeepStrictEqual } from 'node:util';

const uri = process.env.PURNELL_COPY_TARGET_URI;
if (!uri) throw new Error('PURNELL_COPY_TARGET_URI is required');
const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000 });
const apply = process.argv.includes('--apply');
const blank = value => value == null || (typeof value === 'string' && !value.trim());
const specs = [
  { name: 'customers', key: 'customer_id', fields: ['email', 'landline', 'mobile', 'preferred_name', 'privacy_code', 'source', 'source_snapshot_at'] },
  { name: 'repairorders', key: 'ro_number', fields: ['advisor_id', 'source_ro_status', 'source', 'source_snapshot_at', 'vehicle_rego'] },
];
let stage = 'connect';
try {
  await client.connect();
  const db = client.db('Purnell_Pentana_VoiceAgent');
  const plans = [];
  const wrappers = [];
  for (const { name, key, fields } of specs) {
    stage = 'plan:' + name;
    const active = db.collection(name);
    const old = db.collection('previous_cluster_' + name + '_documents');
    const [current, preserved] = await Promise.all([active.find().toArray(), old.find().toArray()]);
    const byKey = new Map(current.map(row => [row[key], row]));
    const changes = [];
    const filled = {};
    let preservedDifferences = 0;
    for (const row of preserved) {
      if (name === 'repairorders' && row.document_kind && row.dataset && Array.isArray(row.rows)) {
        wrappers.push(row);
        continue;
      }
      const target = byKey.get(row[key]);
      if (!target || (name === 'repairorders' && target.customer_id !== row.customer_id)
        || (name === 'customers' && target.customer_name !== row.customer_name)) throw new Error('Identity mismatch');
      const fieldsToSet = {};
      for (const field of fields) {
        if (blank(row[field])) continue;
        if (blank(target[field])) {
          fieldsToSet[field] = row[field];
          filled[field] = (filled[field] || 0) + 1;
        } else if (!isDeepStrictEqual(target[field], row[field])) preservedDifferences++;
      }
      if (Object.keys(fieldsToSet).length) changes.push({ target, fieldsToSet });
    }
    plans.push({ active, changes });
    console.log(JSON.stringify({ collection: name, update_documents: changes.length, filled, populated_values_retained: preservedDifferences }));
  }
  const archive = db.collection('erapower_legacy_repair_datasets');
  const matches = await archive.find({ _id: { $in: wrappers.map(row => row._id) } }).toArray();
  const byId = new Map(matches.map(row => [String(row._id), row]));
  if (wrappers.some(row => byId.has(String(row._id)) && !isDeepStrictEqual(byId.get(String(row._id)), row))) throw new Error('Dataset wrapper conflict');
  console.log(JSON.stringify({ dataset_wrappers: wrappers.length, apply }));
  if (apply) {
    for (const { active, changes } of plans) {
      stage = 'update:' + active.collectionName;
      if (!changes.length) continue;
      const result = await active.bulkWrite(changes.map(({ target, fieldsToSet }) => ({
        updateOne: {
          filter: { _id: target._id, ...Object.fromEntries(Object.keys(fieldsToSet).map(field => [field, target[field] ?? null])) },
          update: { $set: fieldsToSet },
        },
      })));
      if (result.matchedCount !== changes.length) throw new Error('A destination document changed during reconciliation');
      const checked = await active.find({ _id: { $in: changes.map(({ target }) => target._id) } }).toArray();
      const expected = new Map(changes.map(({ target, fieldsToSet }) => [String(target._id), { ...target, ...fieldsToSet }]));
      if (checked.length !== changes.length || checked.some(row => !isDeepStrictEqual(row, expected.get(String(row._id))))) throw new Error('Reconciled documents did not match');
    }
    stage = 'copy:legacy repair datasets';
    const remaining = wrappers.filter(row => !byId.has(String(row._id)));
    if (remaining.length) await archive.insertMany(remaining);
    const checked = await archive.find({ _id: { $in: wrappers.map(row => row._id) } }).toArray();
    const expected = new Map(wrappers.map(row => [String(row._id), row]));
    if (checked.length !== wrappers.length || checked.some(row => !isDeepStrictEqual(row, expected.get(String(row._id))))) throw new Error('Legacy dataset verification failed');
    console.log(JSON.stringify({ verified: true, updated_documents: plans.reduce((count, plan) => count + plan.changes.length, 0), dataset_wrappers: checked.length }));
  }
} catch (error) {
  console.error(JSON.stringify({ stage, error: error.name, code: error.code ?? null }));
  process.exitCode = 1;
} finally {
  await client.close();
}
