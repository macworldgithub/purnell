import { appointmentReply } from './grounded-appointment';
import { FullCustomerProfile } from '../customer-database/customer-database.service';
const profile = { customer: { vehicles: [{ rego: 'RW112' }] }, service_bookings: [{
  booking_id: '2411', vehicle_rego: 'RW112', date: '12/04/2027', time: '08:00',
  job_type: '102,000KM/72 Months MY21.',
}] } as unknown as FullCustomerProfile;
describe('recorded appointment answers', () => {
  it('returns the real reference rather than refusing it', () => {
    expect(appointmentReply(profile, 'appointment number')).toContain('2 4 1 1');
    expect(appointmentReply(profile, 'appointment number')).not.toContain('April');
    expect(appointmentReply(profile, 'appointment number')).not.toContain('Recorded work');
  });
  it('gives only the date and time for a normal appointment question', () => {
    const reply = appointmentReply(profile, 'What is my next recorded service appointment?');
    expect(reply).toContain('12 April 2027 at 8 am');
    expect(reply).not.toContain('RW112');
    expect(reply).not.toContain('2 4 1 1');
    expect(reply).not.toContain('102,000');
  });
  it('answers follow-up questions with only the requested field', () => {
    expect(appointmentReply(profile, 'What work is listed for my appointment?')).toBe('The recorded work is 102,000KM/72 Months MY21.');
    expect(appointmentReply(profile, 'What time is my appointment?')).toBe('The recorded appointment time is 8 am.');
    expect(appointmentReply(profile, 'What are the full appointment details?')).toContain('2 4 1 1');
  });
  it('routes new availability, selections and confirmations to the real backend tools', () => {
    for (const text of ['book tomorrow at eight', 'Do you have any free service slots tomorrow?', 'Can I book a new appointment tomorrow?', 'Can you please tell me if I can get an early appointment', 'I prefer a new appointment on 27 November at 9 AM', 'Yes please save the request', 'Please confirm the request']) {
      expect(appointmentReply(profile, text)).toBeNull();
    }
  });
  it('does not pretend to change or cancel a confirmed booking', () => {
    expect(appointmentReply(profile, 'cancel my booking')).toContain('No booking has been changed');
    expect(appointmentReply(profile, 'change my appointment')).toContain('Please contact Service');
  });
  it('routes new booking requests and date selections to backend tools', () => {
    for (const text of ['book tomorrow at eight', 'available slots', 'a new appointment',
      'save the booking request', 'I choose the first date']) {
      expect(appointmentReply(profile, text)).toBeNull();
    }
  });
  it('does not claim transfers or callbacks', () => {
    expect(appointmentReply(profile, 'send a callback')).toContain('cannot transfer');
  });
  it('never returns an appointment for an unlinked vehicle', () => {
    const other = { ...profile, customer: { vehicles: [{ rego: 'OTHER' }] } } as FullCustomerProfile;
    expect(appointmentReply(other, 'booking reference')).not.toContain('2 4 1 1');
  });
});
