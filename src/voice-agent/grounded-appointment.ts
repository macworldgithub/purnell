import { FullCustomerProfile } from '../customer-database/customer-database.service';
export function appointmentReply(profile: FullCustomerProfile, text: string): string | null {
  if (/\b(availability|available|diary|slots?|tomorrow|reschedule|cancel|change|book me|book a|make a booking)\b/i.test(text))
    return 'I cannot check live availability or create, change or cancel a booking through this service. No booking has been changed and no staff diary check has been initiated. Please contact Service.';
  if (/\b(transfer|callback|put me through|speak to)\b/i.test(text))
    return 'I cannot transfer this browser call or send a callback request. Please contact Service directly.';
  if (!/appointment|booking|booked|service date|work.*listed|listed.*work/i.test(text)) return null;
  const bookings = profile.service_bookings || [];
  if (!bookings.length) return 'No booking is available in this imported profile. This does not establish that no booking exists in Pentana.';
  const plates = new Set((profile.customer.vehicles || []).map(v => v.rego?.replace(/[^A-Z0-9]/gi, '').toUpperCase()));
  const applicable = bookings.filter(b => !!b.vehicle_rego && plates.has(b.vehicle_rego.replace(/[^A-Z0-9]/gi, '').toUpperCase()));
  if (!applicable.length) return 'I cannot reliably link this appointment to a vehicle on this account. Please contact Service.';
  return 'These are recorded appointments, not free slots or a live diary check. ' +
    applicable.map(b => 'Booking reference ' + b.booking_id.split('').join(' ') +
      ', registration ' + b.vehicle_rego + ', recorded date ' + b.date + ' at ' + b.time +
      '. Recorded work: ' + (b.job_type || 'unavailable') + '.').join(' ');
}
