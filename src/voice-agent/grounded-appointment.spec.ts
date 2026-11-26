import { appointmentReply } from './grounded-appointment';
import { FullCustomerProfile } from '../customer-database/customer-database.service';
const profile = { customer: { vehicles: [{ rego: 'RW112' }] }, service_bookings: [{
  booking_id: '2411', vehicle_rego: 'RW112', date: '12/04/2027', time: '08:00',
  job_type: '102,000KM/72 Months MY21.',
}] } as unknown as FullCustomerProfile;
describe('recorded appointment answers', () => {
  it('returns the real reference rather than refusing it', () => {
    expect(appointmentReply(profile, 'appointment number')).toContain('2 4 1 1');
    expect(appointmentReply(profile, 'appointment number')).toContain('12/04/2027');
  });
  it('does not pretend to check or change a diary', () => {
    expect(appointmentReply(profile, 'book tomorrow at eight')).toContain('no staff diary check');
  });
  it('does not claim transfers or callbacks', () => {
    expect(appointmentReply(profile, 'send a callback')).toContain('cannot transfer');
  });
  it('never returns an appointment for an unlinked vehicle', () => {
    const other = { ...profile, customer: { vehicles: [{ rego: 'OTHER' }] } } as FullCustomerProfile;
    expect(appointmentReply(other, 'booking reference')).not.toContain('2 4 1 1');
  });
});
