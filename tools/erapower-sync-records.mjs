import { createHash } from 'node:crypto';
const ignored = new Set(['exported_at', 'source', 'row_index']);
export function contentHash(data) {
  return createHash('sha256').update(JSON.stringify(Object.entries(data).filter(([key, value]) => !ignored.has(key) && value !== '').sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}
export function recordKey(name, data) {
  // History exposes no stable job-line ID. Its display row number shifts when
  // new history is added, so use the source payload and collapse exact repeats.
  if (name === 'service_history') return contentHash(data);
  const keys = {
    customers: ['customer_id'], vehicles: ['serial_no'],
    vehicle_customer_links: ['serial_no', 'customer_id', 'link_source'],
    open_repair_orders: ['ro_number'], repair_order_details: ['ro_number'],
    repair_order_jobs: ['ro_number', 'job_index'],
    repair_job_narratives: ['ro_number', 'job_index'],
    vehicle_service_customer_context: ['serial_no'],
    service_history_summary: ['serial_no'], history_customer_context: ['serial_no'],
    followup_query_coverage: ['customer_id'],
    customer_warnings: ['customer_id'], staff_advisors: ['advisor_id'],
    fsa_advisors: ['advisor_id'],
    customer_privacy_codes: ['code'], status_codes: ['code'],
    workshop_status_codes: ['status_id'],
    service_department_options: ['department_id'],
    workshop_status: ['ro_no', 'dpt'],
    loan_car_status: ['serial_no', 'agree_no_upd', 'date_out', 'date_out_time'],
    appointment_capacity_totals: ['from_date', 'to_date', 'department_id', 'advisor_id'],
    appointments: ['appt_no', 'ro_no', 'serial_no', 'date_in', 'in', 'op_codes', 's_t'],
    customer_followups: ['customer_id', 'date', 'time', 'description', 'stock_or_rego'],
  }[name];
  if (!keys) return contentHash(data);
  const values = keys.map(key => String(data[key] ?? '').trim());
  if (!values.some(Boolean)) throw new Error('Missing identity in ' + name);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export function normalizeHeaders(headers) {
  const fields = headers.map((header, index) => header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'column_' + index);
  if (new Set(fields).size !== fields.length) throw new Error('Ambiguous headers');
  return fields;
}
