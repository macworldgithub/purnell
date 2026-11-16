import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const { MongoClient, BSON } = mongoose.mongo;
const sourceUri = dotenv.parse(await readFile(new URL('../.env', import.meta.url))).MONGO_URI;
const targetUri = process.env.PURNELL_COPY_TARGET_URI;
const database = 'Purnell_Pentana_VoiceAgent';
if (!sourceUri || !targetUri) throw new Error('Both connection strings are required');
const cluster = uri => new URL(uri).hostname.toLowerCase();
if (cluster(sourceUri) === cluster(targetUri)) throw new Error('Source and target must be different clusters');

const options = { serverSelectionTimeoutMS: 12000, promoteLongs: false, promoteValues: false };
const sourceClient = new MongoClient(sourceUri, options);
const targetClient = new MongoClient(targetUri, options);
const apply = process.argv.includes('--apply');
const idKey = id => BSON.EJSON.stringify(id, { relaxed: false });
let stage = 'connect';
try {
  await Promise.all([sourceClient.connect(), targetClient.connect()]);
  const source = sourceClient.db(database);
  const target = targetClient.db(database);
  const [sources, targets] = await Promise.all([source.listCollections().toArray(), target.listCollections().toArray()]);
  const existing = new Map(targets.map(info => [info.name, info]));
  if (sources.some(info => info.type !== 'collection' || info.name.startsWith('system.'))) {
    throw new Error('Source contains a view or special collection requiring a separate migration');
  }
  if (sources.some(info => existing.has(info.name) && existing.get(info.name).type !== 'collection')) {
    throw new Error('Destination namespace type conflict');
  }
  console.log(JSON.stringify({ source_collections: sources.length, destination_collections: targets.length, new_collections: sources.filter(info => !existing.has(info.name)).length }));
  const plans = [];
  async function planCollection(info) {
    stage = 'preflight:' + info.name;
    const origin = source.collection(info.name);
    const destination = target.collection(info.name);
    const [indexes, destinationIndexes, sourceRows, targetRows] = await Promise.all([
      origin.indexes({ promoteValues: true }),
      existing.has(info.name) ? destination.indexes({ promoteValues: true }) : [],
      origin.find().toArray(),
      existing.has(info.name) ? destination.find().toArray() : [],
    ]);
    const indexPlan = [];
    for (const index of indexes.filter(index => index.name !== '_id_')) {
      const sameName = destinationIndexes.find(candidate => candidate.name === index.name);
      const { v, ns, key, ...settings } = index;
      if (sameName) {
        const { v: version, ns: namespace, ...definition } = sameName;
        if (!isDeepStrictEqual({ key, ...settings }, definition)) throw new Error('Existing index differs');
      } else indexPlan.push({ key, settings });
    }
    const targetsById = new Map(targetRows.map(row => [idKey(row._id), row]));
    const missing = sourceRows.filter(row => {
      const current = targetsById.get(idKey(row._id));
      if (current && !isDeepStrictEqual(row, current)) throw new Error('Existing document differs');
      return !current;
    });
    return { info, sourceRows, missing, indexPlan, indexes };
  }
  for (let offset = 0; offset < sources.length; offset += 4) {
    plans.push(...await Promise.all(sources.slice(offset, offset + 4).map(planCollection)));
  }
  const total = plans.reduce((n, p) => n + p.sourceRows.length, 0);
  console.log(JSON.stringify({ database, source_documents: total, documents_to_insert: plans.reduce((n, p) => n + p.missing.length, 0), indexes_to_create: plans.reduce((n,p) => n + p.indexPlan.length, 0), apply }));
  if (apply) {
    let verified = 0;
    for (const { info, sourceRows, missing, indexPlan, indexes } of plans) {
      stage = 'copy:' + info.name;
      if (!existing.has(info.name)) await target.createCollection(info.name, info.options);
      let destination = target.collection(info.name);
      try {
        for (const { key, settings } of indexPlan) await destination.createIndex(key, settings);
        for (let i = 0; i < missing.length; i += 1000) await destination.insertMany(missing.slice(i, i + 1000));
      } catch (error) {
        if (Number(error.code) !== 11000) throw error;
        const preservedName = 'previous_cluster_' + info.name + '_documents';
        stage = 'preserve:' + preservedName;
        if (!existing.has(preservedName)) await target.createCollection(preservedName, info.options);
        destination = target.collection(preservedName);
        const present = new Map((await destination.find().toArray()).map(row => [idKey(row._id), row]));
        const uncopied = sourceRows.filter(row => {
          const prior = present.get(idKey(row._id));
          if (prior && !isDeepStrictEqual(prior, row)) throw new Error('Existing document differs');
          return !prior;
        });
        for (let i = 0; i < uncopied.length; i += 1000) await destination.insertMany(uncopied.slice(i, i + 1000));
        console.log(JSON.stringify({ unique_key_conflict: info.name, preserved_as: preservedName, secondary_indexes_copied: false }));
      }
      stage = 'verify:' + info.name;
      const expected = new Map(sourceRows.map(row => [idKey(row._id), row]));
      for await (const row of destination.find()) {
        const key = idKey(row._id);
        if (!expected.has(key)) continue;
        if (!isDeepStrictEqual(row, expected.get(key))) throw new Error('Copied document differs');
        expected.delete(key);
        verified++;
      }
      if (expected.size) throw new Error('Copied documents missing');
      console.log(JSON.stringify({ verified_collection: destination.collectionName, documents: sourceRows.length }));
    }
    console.log(JSON.stringify({ database, verified_documents: verified, verified_collections: plans.length }));
  }
} catch (error) {
  const safeReasons = ['Existing document differs', 'Existing index differs', 'Copied document differs', 'Copied documents missing', 'Source contains a view or special collection requiring a separate migration', 'Destination namespace type conflict'];
  console.error(JSON.stringify({ stage, error: error.name, code: error.code ?? null, reason: safeReasons.includes(error.message) ? error.message : undefined }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([sourceClient.close(), targetClient.close()]);
}
