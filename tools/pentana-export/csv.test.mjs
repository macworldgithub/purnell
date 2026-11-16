import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from './csv.mjs';

test('CSV round trip preserves leading zeros, phones, commas, quotes, and multiline notes', () => {
  const record = { id: '00058', phone: '+61400111222', note: 'Line 1, "quoted"\nLine 2', blank: '' };
  assert.deepEqual(parseCsv(toCsv(Object.keys(record), [record])).records, [record]);
});
test('CSV validation rejects broken downloads', () => {
  assert.throws(() => parseCsv('id,name\n1'), /column count/);
  assert.throws(() => parseCsv('id,name\n1,"unfinished'), /Unterminated/);
  assert.throws(() => parseCsv('id,id\n1,2'), /Duplicate/);
});
