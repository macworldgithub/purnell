import { asksForNewAppointmentAvailability, capacityAnswer, formatCapacityReply, preferredDate, sydneyDate } from './appointment-capacity';

describe('Recorded daily appointment capacity', () => {
  it('routes new booking requests to availability without confusing existing appointments or staff', () => {
    expect(asksForNewAppointmentAvailability('Can I book a new appointment tomorrow?')).toBe(true);
    expect(asksForNewAppointmentAvailability('Can you please tell me if I can get an early appointment')).toBe(true);
    expect(asksForNewAppointmentAvailability('What dates are available?')).toBe(true);
    expect(asksForNewAppointmentAvailability('What is my next recorded service appointment?')).toBe(false);
    expect(asksForNewAppointmentAvailability('Is Robert available?')).toBe(false);
  });
  const now = new Date('2026-11-26T08:30:00Z');
  const row = (date: string, used = '13', limit = '20', hours = '13') => ({ data: { date, appointments_recorded: used, appointment_limit: limit, unsold_hours: hours, source_captured_at: '2026-11-26T08:00:00Z' } });

  it('offers sorted future dates only when both daily appointment capacity and hours remain', () => {
    const result = capacityAnswer([row('2026-11-30'), row('2026-11-26'), row('2026-11-27'), row('2026-11-28', '0', '0', '0'), row('2026-12-01', '20'), row('2026-12-02', '2', '20', '-1')], undefined, now);
    expect(result.status).toBe('dates_with_capacity');
    expect(result.dates.map(d => d.date)).toEqual(['2026-11-27', '2026-11-30']);
    expect(result.exactTimeSlotsVerified).toBe(false);
    expect(result.bookingConfirmed).toBe(false);
    expect(result.dates[0]).not.toHaveProperty('time');
  });

  it('rejects stale, future-dated or absent observations without returning mock slots', () => {
    const stale = row('2026-11-27'); stale.data.source_captured_at = '2026-11-26T03:00:00Z';
    expect(capacityAnswer([stale], undefined, now).status).toBe('stale');
    stale.data.source_captured_at = '2026-11-27T03:00:00Z';
    expect(capacityAnswer([stale], undefined, now).dates).toEqual([]);
    expect(capacityAnswer([], undefined, now).status).toBe('unavailable');
  });

  it('honours a preferred date and distinguishes unchecked dates from a full day', () => {
    const rows = [row('2026-11-27'), row('2026-11-30', '20')];
    expect(capacityAnswer(rows, 'tomorrow', now).dates.map(d => d.date)).toEqual(['2026-11-27']);
    expect(capacityAnswer(rows, '30/11/2026', now).status).toBe('no_capacity_in_checked_dates');
    expect(capacityAnswer(rows, '2027-01-01', now).status).toBe('outside_checked_window');
    expect(capacityAnswer(rows, 'today', now).status).toBe('same_day_or_past');
    expect(capacityAnswer(rows, '31/02/2027', now).status).toBe('clarify_date');
  });

  it('uses Sydney dates across UTC midnight boundaries and validates input', () => {
    expect(sydneyDate(new Date('2026-11-26T14:00:00Z'))).toBe('2026-11-27');
    expect(preferredDate('monday', '2026-11-26')).toBe('2026-11-30');
    expect(preferredDate('earliest', '2026-11-26')).toBeUndefined();
    expect(preferredDate('next month sometime', '2026-11-26')).toBeNull();
    expect(capacityAnswer([row('2026-11-27', '', '20', '13')], undefined, now).dates).toEqual([]);
  });

  it('speaks recorded dates and source time without promising slots or booking actions', () => {
    const answer = formatCapacityReply(capacityAnswer([row('2026-11-27')], undefined, now));
    expect(answer).toMatch(/Friday,? 27 November/);
    expect(answer).toContain('26 Nov');
    expect(answer).toContain('Service must confirm');
    expect(answer).not.toMatch(/slots available|I can confirm|booked you/i);
    expect(formatCapacityReply({ status: 'stale' })).toContain('too old');
  });
});
