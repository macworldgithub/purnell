import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { parseCsv } from './pentana-export/csv.mjs';

const original = new URL('./pentana-export/exports/erapower-scope-2026-11-13/', import.meta.url);
const supplement = new URL('./pentana-export/exports/erapower-gap-2026-11-16/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', original), 'utf8'));
const sources = [
  ...manifest.files.map(entry => ({ ...entry, root: original, bundle: '2026-11-13' })),
  ...['field_coverage.csv', 'scope_coverage.csv'].map(file => ({ file, root: original, bundle: '2026-11-13' })),
  ...(await readdir(supplement)).filter(file => file.endsWith('.csv')).map(file => ({ file, root: supplement, bundle: '2026-11-16' })),
];

const datasets = new Map();
const inventory = [];
for (const source of sources) {
  const bytes = await readFile(new URL(source.file, source.root));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { headers, rows } = parseCsv(bytes.toString('utf8'));
  if (source.sha256 && (source.sha256 !== sha256 || source.rows !== rows.length)) {
    throw new Error('Snapshot verification failed for ' + source.file);
  }
  const collection = 'erapower_' + basename(source.file, '.csv');
  if (!/^erapower_[a-z0-9_]+$/.test(collection)) throw new Error('Invalid collection name');
  const sourceId = source.bundle + '/' + source.file;
  const used = new Set();
  const fields = headers.map((header, index) => {
    const base = header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'column_' + (index + 1);
    let field = base;
    for (let suffix = 2; used.has(field); suffix++) field = base + '_' + suffix;
    used.add(field);
    return field;
  });
  inventory.push({ _id: sourceId, collection, headers, fields, sha256, row_count: rows.length });
  if (!datasets.has(collection)) datasets.set(collection, []);
  const documents = datasets.get(collection);
  rows.forEach((values, index) => documents.push({
    _id: sourceId + '/' + (index + 1),
    source_file: sourceId,
    row_number: index + 1,
    data: Object.fromEntries(fields.map((field, i) => [field, values[i]])),
  }));
}
const rowCount = [...datasets.values()].reduce((total, rows) => total + rows.length, 0);
const summary = { csv_files: inventory.length, dataset_collections: datasets.size, rows: rowCount };
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ ...summary, collections: [...datasets.keys()] }));
} else {
  dotenv.config({ quiet: true });
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  let stage = 'connect';
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 12000 });
    const db = mongoose.connection.db;
    let completed = 0;
    const resumeFrom = process.argv.find(arg => arg.startsWith('--resume-from='))?.slice(14);
    if (resumeFrom && !datasets.has(resumeFrom)) throw new Error('Unknown resume collection');
    let resumeReached = !resumeFrom;
    for (const [name, documents] of datasets) {
      if (name === resumeFrom) resumeReached = true;
      if (!resumeReached) continue;
      stage = name;
      const collection = db.collection(name);
      if (!documents.length && !await db.listCollections({ name }).hasNext()) await db.createCollection(name);
      for (let offset = 0; offset < documents.length; offset += 1000) {
        const batch = documents.slice(offset, offset + 1000);
        const existing = await collection.find({ _id: { $in: batch.map(row => row._id) } }).toArray();
        const expected = new Map(batch.map(row => [row._id, row]));
        for (const row of existing) {
          if (JSON.stringify(row) !== JSON.stringify(expected.get(row._id))) throw new Error('Existing snapshot row differs');
          expected.delete(row._id);
        }
        if (expected.size) await collection.insertMany([...expected.values()]);
        const verified = await collection.find({ _id: { $in: batch.map(row => row._id) } }).toArray();
        const originals = new Map(batch.map(row => [row._id, row]));
        if (verified.length !== batch.length || verified.some(row => JSON.stringify(row) !== JSON.stringify(originals.get(row._id)))) {
          throw new Error('Database verification failed');
        }
      }
      completed++;
      if (completed % 10 === 0) console.log('Verified collections: ' + completed + '/' + datasets.size);
    }
    stage = 'erapower_dataset_catalog';
    const catalog = db.collection(stage);
    await catalog.bulkWrite(inventory.map(document => ({ replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } })));
    const verified = await catalog.find({ _id: { $in: inventory.map(file => file._id) } }).toArray();
    const expected = new Map(inventory.map(file => [file._id, file]));
    if (verified.length !== inventory.length || verified.some(file => JSON.stringify(file) !== JSON.stringify(expected.get(file._id)))) {
      throw new Error('Dataset catalog verification failed');
    }
    console.log(JSON.stringify({ ...summary, database: db.databaseName, verified: true, catalog: stage }));
  } catch (error) {
    const reason = /quota|storage|disk|space/i.test(error.message) ? 'storage quota'
      : /limit|maximum|too many/i.test(error.message) ? 'server limit'
      : /unauthor|permission/i.test(error.message) ? 'permission'
      : /differs|verification/i.test(error.message) ? 'verification mismatch' : 'unclassified';
    const detail = stage === 'erapower_field_coverage' && error.code === 8000 ? error.message : undefined;
    console.error(JSON.stringify({ stage, error: error.name, code: error.code ?? null, reason, detail }));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
