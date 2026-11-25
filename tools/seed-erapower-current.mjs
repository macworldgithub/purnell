import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { parseCsv } from './pentana-export/csv.mjs';
import { contentHash, recordKey, normalizeHeaders } from './erapower-sync-records.mjs';
const input = process.argv.find(arg => arg.startsWith('--input='))?.slice(8);
if (!input || !process.env.PURNELL_COPY_TARGET_URI) throw new Error('Input and target URI are required');
const folder = resolve(input);
const manifest = JSON.parse(await readFile(join(folder, 'full-sync-manifest.json'), 'utf8'));
const client = new mongoose.mongo.MongoClient(process.env.PURNELL_COPY_TARGET_URI, { serverSelectionTimeoutMS: 12000 });
const result = { datasets: [] };
let stage = 'connect';
try {
  await client.connect();
  const db = client.db('Purnell_Pentana_VoiceAgent');
  const history = db.collection('erapower_record_history');
  for (const item of manifest.datasets.filter(item => item.file)) {
    stage = item.name;
    const bytes = await readFile(join(folder, item.file));
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('File changed after validation');
    const csv = parseCsv(bytes.toString('utf8'));
    const fields = normalizeHeaders(csv.headers);
    const rows = new Map();
    for (const values of csv.rows) {
      const data = Object.fromEntries(fields.map((field, i) => [field, values[i]]));
      const key = recordKey(item.name, data);
      if (rows.has(key) && contentHash(rows.get(key)) !== contentHash(data)) throw new Error('Conflicting duplicate identity in ' + item.name);
      rows.set(key, data);
    }
    const collection = db.collection('erapower_current_' + item.name);
    const existing = new Map((await collection.find().toArray()).map(row => [row._id, row]));
    if ([...existing.values()].some(row => Date.parse(row.observed_at) > Date.parse(manifest.startedAt))) {
      result.datasets.push({ collection: collection.collectionName, new_rows: 0, updated_rows: 0, already_present: 0, older_snapshot_skipped: true, complete: item.complete });
      continue;
    }
    let inserted = 0, updated = 0, unchanged = 0;
    const writes = [], versions = [];
    for (const [key, data] of rows) {
      const prior = existing.get(key);
      const hash = contentHash(data);
      const priorHash = prior ? contentHash(prior.data) : null;
      if (!prior) inserted++;
      else if (priorHash !== hash) updated++;
      else unchanged++;
      if (prior && priorHash !== hash) versions.push({
        updateOne: { filter: { _id: item.name + '/' + key + '/' + priorHash },
          update: { $setOnInsert: { dataset: item.name, record_id: key, content_hash: priorHash, data: prior.data, observed_at: prior.observed_at } }, upsert: true },
      });
      // Later stages republish the same manifest. Records already verified in
      // this run need no second write; a new run still refreshes observation metadata.
      if (!prior || prior.content_hash !== hash || prior.run_id !== manifest.runId || prior.source_file !== item.file || prior.listed_in_latest_report !== true) writes.push({ updateOne: { filter: { _id: key },
        update: { $set: { data, content_hash: hash, observed_at: manifest.startedAt, run_id: manifest.runId, source_file: item.file, listed_in_latest_report: true } }, upsert: true } });
    }
    if (versions.length) await history.bulkWrite(versions);
    if (writes.length) await collection.bulkWrite(writes);
    const currentIds = [...rows.keys()];
    if (item.complete) await collection.updateMany({ _id: { $nin: currentIds } }, { $set: { listed_in_latest_report: false } });
    const checked = await collection.find({ _id: { $in: currentIds } }).toArray();
    if (checked.length !== rows.size || checked.some(row => !rows.has(row._id) || row.content_hash !== contentHash(rows.get(row._id)))) throw new Error('Current record verification failed');
    result.datasets.push({ collection: collection.collectionName, new_rows: inserted, updated_rows: updated, already_present: unchanged, complete: item.complete });
  }
  await db.collection('erapower_sync_runs').updateOne({ _id: manifest.runId }, { $set: { startedAt: manifest.startedAt, completedAt: new Date().toISOString(), datasets: result.datasets, limitations: manifest.limitations } }, { upsert: true });
  await writeFile(join(folder, 'mongodb-current-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ stage, error: error.name, code: error.code ?? null }));
  process.exitCode = 1;
} finally { await client.close(); }
