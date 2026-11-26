import { FullCustomerProfile } from '../customer-database/customer-database.service';

export function groundedRepairReply(profile: FullCustomerProfile, text: string): string {
  const orders = profile.repair_orders || [];
  if ((profile.customer.vehicles || []).length > 1)
    return 'This account has multiple vehicles. Please contact Service to confirm the selected vehicle before I disclose repair details.';
  const snapshot = (orders[0] as unknown as { pentana_snapshot?: string })?.pentana_snapshot;
  const prefix = snapshot ? 'These are imported records dated ' + snapshot + ', not a live workshop update. ' : 'This is the recorded information, not a confirmed live update. ';
  if (/\b(parts?|arriv|receipt)/i.test(text))
    return prefix + 'Parts arrival information is not available in these records. Please contact Service for confirmation.';
  if (/\b(cost|price|quote|estimate|approval|approve|brake|rotor|pad)\b|\$/i.test(text))
    return prefix + 'I cannot confirm a technician diagnosis, repair recommendation, price or work approval request from these records. Please speak with your service advisor.';
  if (!orders.length) return prefix + 'No repair order is available in this imported profile. This does not establish that no order exists in Pentana.';
  return prefix + orders.map(order => {
    const r = order as unknown as Record<string, unknown>;
    const notes = Array.isArray(r.source_narratives) ? r.source_narratives as Record<string, unknown>[] : [];
    const details = notes.map(n => [
      n.complaint ? 'Customer-reported concern: ' + String(n.complaint) : '',
      n.cause ? 'Recorded cause: ' + String(n.cause) : '',
      n.correction ? 'Recorded correction: ' + String(n.correction) : '',
    ].filter(Boolean).join('. ')).filter(Boolean).join('. ');
    return 'Repair order ' + order.ro_number.split('').join(' ') +
      ', registration ' + order.vehicle_rego + '. Recorded status: ' + order.status +
      '. Advisor: ' + order.advisor + '. Recorded drop-off: ' + (order.drop_off_date || 'unavailable') +
      (r.promised_date ? '. Historical recorded promised date: ' + String(r.promised_date) + ' ' + String(r.promised_time || '') : '') +
      (details ? '. ' + details : '. Technician findings and readable job details are unavailable') +
      '. No confirmed current completion time, price or work approval request is available.';
  }).join(' ');
}
