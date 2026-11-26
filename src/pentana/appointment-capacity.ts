export const CAPACITY_MAX_AGE_MS = 4 * 60 * 60 * 1000;

export function asksForNewAppointmentAvailability(text: string): boolean {
  if (/\b(existing|recorded|reference|cancel|reschedule)\b|\bmy next\b|\bwhen is my\b/i.test(text)) return false;
  return /\bslots\b/i.test(text) || /\b(availability|available|openings)\b/i.test(text) && /\b(appointments?|service|booking|dates?|times?)\b/i.test(text) || /\b(can|could|may)\s+i\s+(?:please\s+)?(?:book|schedule|arrange)\b/i.test(text) || /\b(?:want|need|would like)\s+to\s+(?:book|schedule)\s+(?:a\s+)?(?:new\s+)?(?:appointment|service)\b/i.test(text);
}

export function sydneyDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function preferredDate(value: string | undefined, today: string): string | null | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim().toLowerCase();
  const add = (days: number) => new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  if (text === 'today') return today;
  if (text === 'tomorrow') return add(1);
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const index = weekdays.indexOf(text.replace(/^next\s+/, ''));
  if (index >= 0) return add((index - new Date(today + 'T00:00:00Z').getUTCDay() + 7) % 7 || 7);
  const australian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = australian ? `${australian[3]}-${australian[2]}-${australian[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export interface CapacityResult {
  timezone: string; source: string; department: string; advisorScope: string;
  availabilityType: string; exactTimeSlotsVerified: boolean; bookingConfirmed: boolean;
  status: string; checkedAt?: string; message: string;
  dates: { date: string; appointmentCapacityRemaining: number; unsoldWorkshopHours: number }[];
}

export function capacityAnswer(docs: any[], preference?: string, now = new Date()): CapacityResult {
  const base = { timezone: 'Australia/Sydney', source: 'eraPower Service appointment booking summary', department: 'Service', advisorScope: 'all', availabilityType: 'daily_capacity_only', exactTimeSlotsVerified: false, bookingConfirmed: false };
  const today = sydneyDate(now);
  const date = preferredDate(preference, today);
  if (date === null) return { ...base, status: 'clarify_date', dates: [], message: 'Please ask for an exact preferred date.' };
  if (!docs.length) return { ...base, status: 'unavailable', dates: [], message: 'No verified Service capacity snapshot is available. Do not offer invented dates or times.' };
  const timestamps = docs.map(doc => Date.parse(doc.data?.source_captured_at || doc.observed_at));
  const checked = Math.min(...timestamps);
  if (!Number.isFinite(checked) || checked > now.getTime() + 60000 || now.getTime() - checked > CAPACITY_MAX_AGE_MS) return { ...base, status: 'stale', dates: [], message: 'The capacity snapshot is stale or unverified. Ask the service team to check availability.' };
  const checkedAt = new Date(checked).toISOString();
  const rows = docs.map(doc => doc.data).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date || '')).sort((a, b) => a.date.localeCompare(b.date));
  if (date && date <= today) return { ...base, checkedAt, status: 'same_day_or_past', dates: [], message: 'Past dates cannot be offered. Same-day availability needs a live time-slot check by the service team.' };
  if (date && !rows.some(row => row.date === date)) return { ...base, checkedAt, status: 'outside_checked_window', dates: [], message: 'That date is outside the verified calendar window. Ask the service team to check it.' };
  const candidates = rows.filter(row => row.date > today && (!date || row.date === date));
  const dates = candidates.filter(row => {
    const used = Number(row.appointments_recorded), limit = Number(row.appointment_limit), hours = Number(row.unsold_hours);
    return [row.appointments_recorded, row.appointment_limit, row.unsold_hours].every(v => typeof v === 'string' && v.trim() !== '') && [used, limit, hours].every(Number.isFinite) && used >= 0 && limit > used && hours > 0;
  }).slice(0, 5).map(row => ({ date: row.date, appointmentCapacityRemaining: Number(row.appointment_limit) - Number(row.appointments_recorded), unsoldWorkshopHours: Number(row.unsold_hours) }));
  return { ...base, checkedAt, status: dates.length ? 'dates_with_capacity' : 'no_capacity_in_checked_dates', dates, message: dates.length ? 'These dates show recorded daily Service capacity. Say when it was checked. A suitable time and job-specific availability must be confirmed by the service team. Do not invent times or say a booking was made.' : 'No remaining daily capacity was recorded in the checked dates. This does not establish availability outside that window.' };
}

export function formatCapacityReply(result: { status?: string; checkedAt?: string; dates?: { date: string }[]; message?: string }): string {
  if (result.status !== 'dates_with_capacity' || !result.checkedAt || !result.dates?.length) {
    const messages: Record<string, string> = {
      stale: 'The latest diary information is too old to offer dates confidently. Service will need to check availability.',
      unavailable: 'I cannot verify appointment availability right now. Service will need to check the diary.',
      clarify_date: 'Which date would you prefer? Please give me the day, month and year.',
      same_day_or_past: 'For today, Service needs to check an actual appointment time; I cannot offer a past date.',
      outside_checked_window: 'That date is outside the diary window I have checked. Service will need to check it.',
      no_capacity_in_checked_dates: 'The checked dates do not show remaining daily Service capacity. Service can check other dates or requirements.',
    };
    return messages[result.status || ''] || messages.unavailable;
  }
  const dateFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long' });
  const dates = result.dates.slice(0, 3).map(row => dateFormat.format(new Date(row.date + 'T12:00:00+11:00')));
  const list = dates.length > 1 ? dates.slice(0, -1).join(', ') + ' and ' + dates.at(-1) : dates[0];
  const checked = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(result.checkedAt));
  return `The diary checked on ${checked} shows daily Service capacity on ${list}. Which date and preferred drop-off time would you like to request? Service must confirm the time and job availability; no booking is confirmed yet.`;
}
