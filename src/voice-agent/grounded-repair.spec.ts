import { groundedRepairReply } from './grounded-repair';
import { FullCustomerProfile } from '../customer-database/customer-database.service';
const profile = {
  customer: { customer_id: 'C1' },
  repair_orders: [{
    ro_number: 'L3521', vehicle_rego: 'KLP', status: 'OPEN', advisor: 'Kamal',
    drop_off_date: '10/07/2026', promised_date: '07/10/2026',
    pentana_snapshot: '2026-10-26',
    source_narratives: [{ complaint: 'Check suspension swaying', cause: '', correction: '' }],
  }],
} as unknown as FullCustomerProfile;
describe('source grounded repair answers', () => {
  it('blocks invented costs and approvals', () => {
    const answer = groundedRepairReply(profile, 'Do brake pads cost $450? Can I approve?');
    expect(answer).not.toContain('450');
    expect(answer).toContain('cannot confirm');
  });
  it('preserves references and historical dates', () => {
    const answer = groundedRepairReply(profile, 'repair order reference and status');
    expect(answer).toContain('L 3 5 2 1');
    expect(answer).toContain('Customer-reported concern: Check suspension swaying');
    expect(answer).toContain('not a live workshop update');
  });
  it('reports missing parts explicitly', () => {
    expect(groundedRepairReply(profile, 'Have parts arrived?')).toContain('not available');
  });
});
