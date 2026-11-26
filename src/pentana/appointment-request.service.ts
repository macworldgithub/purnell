import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppointmentAvailabilityService } from './appointment-availability.service';
import { preferredDate, sydneyDate } from './appointment-capacity';

export interface AppointmentCallContext { callId: string; turnId: string; callerText: string }
interface Draft {
  id: string; callKey: string; customerId: string; customerName: string; registration: string;
  date: string; time: string | null; reason: string; checkedAt: string; preparedTurn: string; expiresAt: number;
}
export function explicitRequestConfirmation(text: string): boolean {
  // Only used after a server-side read-back. Do not interpret a question,
  // condition, negation, or a changed detail as consent to the old draft.
  if (text.includes('?')) return false;
  const value = text.toLowerCase().replace(/[’]/g, "'")
    .replace(/\[(?:cough|breath|lip smack)[^\]]*\]/g, ' ')
    .replace(/[.!?,;:]/g, ' ').replace(/\b(?:uh|um|ah|erm)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (/\b(no|not|dont|don't|do not|cannot|can't|won't|cancel|wait|hold|change|instead|maybe|but|actually|if|unless|except|before|after|only|perhaps|might)\b/.test(value)) return false;
  const affirmative = [
    'yes', 'yeah', 'yep', 'yup', 'certainly', 'absolutely', 'sure',
    'okay', 'ok', 'alright', 'all right', 'agreed', 'confirmed', 'confirm',
    'proceed', 'go ahead', 'go for it', 'do it',
    'sounds good', 'sounds fine', 'that works', 'that works for me',
    "that's correct", 'thats correct', 'that is correct',
    "that's right", 'thats right', 'that is right',
    "that's fine", 'thats fine', 'that is fine',
    "that's good", 'thats good', 'that is good',
    "that's okay", 'thats okay', 'that is okay',
    'i agree', 'i confirm', 'i confirm the request', 'i confirm that',
    'save', 'save it', 'save that', 'save this', 'save the request',
    'save that request', 'save this request', 'save my request',
    'save it for me', 'save that for me', 'save the booking request',
    'save my appointment request', 'go ahead and save it',
    'proceed with the request', 'proceed with it',
    'book that', 'book it', 'book that in', 'book me in',
  ];
  const polite = ['please', 'thanks', 'thank you', 'and'];
  // Consume whole approved phrases, longest first. Unknown words (including
  // times, registrations and alternative dates) require a new read-back.
  const phrases = [...affirmative, ...polite].sort((a, b) => b.length - a.length);
  let remaining = value, confirmed = false;
  while (remaining) {
    const phrase = phrases.find(p => remaining === p || remaining.startsWith(p + ' '));
    if (!phrase) return false;
    if (affirmative.includes(phrase)) confirmed = true;
    remaining = remaining.slice(phrase.length).trimStart();
  }
  return confirmed;
}

@Injectable()
export class AppointmentRequestService {
  private readonly drafts = new Map<string, Draft>();
  constructor(private readonly availability: AppointmentAvailabilityService) {}
  private callKey(context: AppointmentCallContext, customerId: string) {
    return createHash('sha256').update(context.callId + '/' + customerId).digest('hex');
  }

  beginTurn(context: AppointmentCallContext, customerId: string) {
    const key = this.callKey(context, customerId), draft = this.drafts.get(key);
    // A refusal, changed detail or intervening question requires a fresh read-back.
    if (draft && draft.preparedTurn !== context.turnId && !explicitRequestConfirmation(context.callerText)) this.drafts.delete(key);
  }

  getPending(context: AppointmentCallContext, customerId: string) {
    const draft = this.drafts.get(this.callKey(context, customerId));
    if (!draft || draft.expiresAt < Date.now()) return null;
    return { draftId: draft.id, date: draft.date, preferredTime: draft.time, registration: draft.registration, reason: draft.reason };
  }

  async prepare(args: Record<string, unknown>, customer: { customer_id: string; customer_name: string; vehicles?: { rego: string }[] }, context?: AppointmentCallContext) {
    if (!context?.callId || !context.turnId || !customer.customer_id) return { status: 'unavailable', response: 'Please start a verified call before saving an appointment request.' };
    const normalize = (value: string) => value.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const vehicles = customer.vehicles || [];
    const registration = typeof args.registration === 'string' ? normalize(args.registration) : vehicles.length === 1 ? normalize(vehicles[0].rego) : '';
    if (!registration) return { status: 'needs_vehicle', response: 'Which of your registered vehicles is this service request for?' };
    if (!vehicles.some(v => normalize(v.rego) === registration)) return { status: 'unverified_vehicle', response: 'That vehicle is not verified on this account. Service will need to verify it before I can save a request for it.' };
    const requested = typeof args.preferredDate === 'string' ? args.preferredDate : '';
    const date = preferredDate(requested, sydneyDate(new Date()));
    if (!date) return { status: 'needs_date', response: 'Which date would you like to request?' };
    const time = typeof args.preferredTime === 'string' && args.preferredTime.trim() ? args.preferredTime.trim() : null;
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { status: 'needs_time', response: 'What time would you prefer, including AM or PM?' };
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (!reason || reason.length > 1000) return { status: 'needs_reason', response: 'What service or work would you like to request?' };
    const capacity = await this.availability.getAvailability(date);
    if (capacity.status !== 'dates_with_capacity' || !capacity.dates.some(d => d.date === date) || !capacity.checkedAt) return { status: 'capacity_unverified', response: 'I cannot verify recorded daily capacity for that date right now. Please choose another checked date or ask Service to check.' };
    for (const [key, draft] of this.drafts) if (draft.expiresAt < Date.now()) this.drafts.delete(key);
    const key = this.callKey(context, customer.customer_id);
    const old = this.drafts.get(key);
    const same = old && old.date === date && old.time === time && old.registration === registration && old.reason === reason;
    const draft: Draft = same ? old : { id: randomUUID(), callKey: key, customerId: customer.customer_id, customerName: customer.customer_name, registration, date, time, reason, checkedAt: capacity.checkedAt, preparedTurn: context.turnId, expiresAt: Date.now() + 10 * 60000 };
    draft.preparedTurn = context.turnId;
    draft.expiresAt = Date.now() + 10 * 60000;
    draft.checkedAt = capacity.checkedAt;
    this.drafts.set(key, draft);
    const day = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date + 'T12:00:00+11:00'));
    const clock = time ? `${Number(time.slice(0, 2)) % 12 || 12}:${time.slice(3)} ${Number(time.slice(0, 2)) < 12 ? 'am' : 'pm'}` : 'a time to be arranged';
    return { status: 'awaiting_caller_confirmation', draftId: draft.id, response: `You would like to request ${reason} for registration ${registration.split('').join(' ')} on ${day}, ${time ? `with ${clock} as your preferred time` : 'with the time still to be arranged'}. This time is not verified or reserved; shall I save the request for Service to confirm?` };
  }

  async confirm(draftId: unknown, customerId: string, context?: AppointmentCallContext) {
    if (!context?.callId || !customerId) return { status: 'unavailable', response: 'Please start a verified call before saving an appointment request.' };
    const draft = this.drafts.get(this.callKey(context, customerId));
    if (!draft || draft.id !== draftId || draft.expiresAt < Date.now()) return { status: 'no_pending_request', response: 'Please tell me your preferred date, time and vehicle so I can read the request back before saving it.' };
    if (draft.preparedTurn === context.turnId || !explicitRequestConfirmation(context.callerText)) return { status: 'confirmation_required', response: 'Please confirm whether you want me to save that date and preferred time as a request for Service to confirm.' };
    try {
      const collection = (await this.availability.getDataDatabase()).collection<{ _id: string; customer_id: string; status: string; [key: string]: unknown }>('voice_appointment_requests');
      const success = (alreadySaved: boolean) => ({
        status: 'saved_pending_service_confirmation', requestId: draft.id, alreadySaved,
        response: 'Your request reference is ' + draft.id + '. I have saved ' + draft.reason +
          ' for registration ' + draft.registration + ' on ' + draft.date +
          (draft.time ? ', preferred time ' + draft.time : ', time to be arranged') +
          '. It is pending Service confirmation, not a confirmed booking or reserved time. Your existing appointment has not been changed.',
      });
      const existing = await collection.findOne({ _id: draft.id, customer_id: customerId });
      if (existing?.status === 'pending_service_confirmation') return success(true);
      const capacity = await this.availability.getAvailability(draft.date);
      if (capacity.status !== 'dates_with_capacity' || !capacity.dates.some(d => d.date === draft.date) || !capacity.checkedAt) return { status: 'capacity_changed', response: 'The date no longer has verified recorded capacity. I have not saved a new request; Service will need to check it.' };
      const result = await collection.updateOne({ _id: draft.id }, { $setOnInsert: {
        request_id: draft.id, customer_id: draft.customerId, customer_name: draft.customerName, vehicle_rego: draft.registration,
        requested_date: draft.date, preferred_time: draft.time, timezone: 'Australia/Sydney', reason: draft.reason,
        status: 'pending_service_confirmation', booking_confirmed: false, time_slot_verified: false, capacity_reserved: false,
        pentana_booking_id: null, pentana_write_performed: false, capacity_checked_at: capacity.checkedAt,
        caller_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), call_id_hash: draft.callKey, source: 'voice_agent',
      } }, { upsert: true });
      const saved = await collection.findOne({ _id: draft.id, customer_id: customerId });
      if (!saved || saved.status !== 'pending_service_confirmation' || saved.requested_date !== draft.date || saved.preferred_time !== draft.time) throw new Error('Request read-back failed');
      return success(result.upsertedCount === 0);
    } catch {
      return { status: 'save_unverified', response: 'I could not verify that your request was saved. Please ask Service to check before making another request; no booking has been confirmed.' };
    }
  }
}
