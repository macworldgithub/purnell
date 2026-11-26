import { FullCustomerProfile } from '../customer-database/customer-database.service';
import { asksForNewAppointmentAvailability } from '../pentana/appointment-capacity';
export function appointmentReply(profile: FullCustomerProfile, text: string): string | null {
  if (/\b(reschedule|cancel|change)\b/i.test(text) && /\b(appointment|booking|booked)\b/i.test(text))
    return 'I cannot change or cancel a confirmed booking through this service. No booking has been changed. Please contact Service.';
  // New requests and their follow-ups must reach the real capacity/request tools.
  // This shortcut answers recorded appointment questions only.
  if (asksForNewAppointmentAvailability(text)) return null;
  if (/\b(availability|available|diary|slots?|tomorrow|book|new|request|prefer|preferred|save|confirm|yes)\b/i.test(text)) return null;
  if (/\b(transfer|callback|put me through|speak to)\b/i.test(text))
    return 'I cannot transfer this browser call or send a callback request. Please contact Service directly.';
  if (!/appointment|booking|booked|service date|work.*listed|listed.*work/i.test(text)) return null;
  const bookings = profile.service_bookings || [];
  if (!bookings.length) return 'No booking is available in this imported profile. This does not establish that no booking exists in Pentana.';
  const plates = new Set((profile.customer.vehicles || []).map(v => v.rego?.replace(/[^A-Z0-9]/gi, '').toUpperCase()));
  const applicable = bookings.filter(b => !!b.vehicle_rego && plates.has(b.vehicle_rego.replace(/[^A-Z0-9]/gi, '').toUpperCase()));
  if (!applicable.length) return 'I cannot reliably link this appointment to a vehicle on this account. Please contact Service.';
  const isoDate = (value: string) => {
    const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const future = applicable.filter(b => isoDate(b.date) >= today).sort((a, b) => isoDate(a.date).localeCompare(isoDate(b.date)) || (a.time || '').localeCompare(b.time || ''));
  const booking = future[0] || [...applicable].sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)))[0];
  const date = isoDate(booking.date);
  const day = date && Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(date + 'T00:00:00Z')) : booking.date || 'an unrecorded date';
  const match = booking.time?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const time = match ? `${Number(match[1]) % 12 || 12}${match[2] === '00' ? '' : ':' + match[2]} ${Number(match[1]) < 12 ? 'am' : 'pm'}` : booking.time;
  const reference = booking.booking_id.split('').join(' ');
  const work = booking.job_type?.replace(/\.+$/, '') || 'not available';
  if (/\b(all|full|complete)\b.*\bdetails\b|\beverything\b/i.test(text)) {
    return `Your recorded appointment is on ${day}${time ? ' at ' + time : ''}, reference ${reference}, for registration ${booking.vehicle_rego}. Recorded work: ${work}.`;
  }
  if (/\b(reference|number|id)\b/i.test(text)) return `Your booking reference is ${reference}.`;
  if (/\b(work|job|jobs|included|includes)\b/i.test(text)) return `The recorded work is ${work}.`;
  if (/\b(registration|rego|vehicle|car)\b/i.test(text)) return `It's for registration ${booking.vehicle_rego?.split('').join(' ')}.`;
  if (/\b(advisor|adviser)\b/i.test(text)) return booking.advisor ? `The recorded advisor is ${booking.advisor}.` : 'No advisor is recorded for that appointment.';
  if (/\btime\b/i.test(text) && !/\b(date|when)\b/i.test(text)) return time ? `The recorded appointment time is ${time}.` : 'The appointment time is not recorded.';
  return `Your ${future.length ? 'next' : 'latest'} recorded appointment is on ${day}${time ? ' at ' + time : '; the time is not recorded'}.`;
}
