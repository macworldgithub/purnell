import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, recordKey, normalizeHeaders } from './erapower-sync-records.mjs';
test('Changed order retains identity while producing a new content version', () => {
  const before = { ro_number: '00123', status: 'Awaiting Parts', exported_at: 'old' };
  const same = { ...before, exported_at: 'new' };
  const changed = { ...same, status: 'Vehicle Arrived' };
  assert.equal(recordKey('open_repair_orders', before), recordKey('open_repair_orders', changed));
  assert.equal(contentHash(before), contentHash(same));
  assert.notEqual(contentHash(before), contentHash(changed));
  assert.equal(contentHash(before), contentHash({ ...before, new_optional_field: '' }));
});
test('Customer identifiers and distinct appointment job lines retain their identities', () => {
  assert.notEqual(recordKey('customers', { customer_id: '001' }), recordKey('customers', { customer_id: '1' }));
  assert.notEqual(recordKey('appointments', { appt_no: '1', op_codes: 'A' }), recordKey('appointments', { appt_no: '1', op_codes: 'B' }));
  assert.throws(() => recordKey('customers', {}));
  assert.throws(() => normalizeHeaders(['a b', 'a-b']));
});
test('Service history identity survives display row shifts and repeated exports', () => {
  const row = { serial_no: 'VIN', ro_number: '123', operation_code: 'SERVICE', operation_description: 'Service', row_index: '1', exported_at: 'old' };
  assert.equal(recordKey('service_history', row), recordKey('service_history', { ...row, row_index: '8', exported_at: 'new' }));
});
test('Vehicle references remain distinct from maintenance customer associations', () => {
  const reference = { serial_no: 'VIN', customer_id: '001', link_source: 'vehicle_search_report_references' };
  assert.notEqual(recordKey('vehicle_customer_links', reference), recordKey('vehicle_customer_links', { ...reference, link_source: 'vehicle_maintenance_customer' }));
  assert.equal(recordKey('vehicle_customer_links', reference), recordKey('vehicle_customer_links', { ...reference, exported_at: 'new' }));
});
