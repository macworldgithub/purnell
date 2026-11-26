import { AppointmentRequestService, explicitRequestConfirmation } from './appointment-request.service';
import { AppointmentAvailabilityService } from './appointment-availability.service';

describe('Caller-confirmed appointment requests', () => {
  const customer = { customer_id: 'TEST-C1', customer_name: 'Test Customer', vehicles: [{ rego: 'TEST01' }] };
  const context = (turnId = 'turn-1', callerText = 'Tomorrow at nine AM for a service') => ({ callId: 'test-private-call-token', turnId, callerText });
  const args = { preferredDate: 'tomorrow', preferredTime: '09:00', reason: 'service', registration: 'TEST01' };
  let records: Map<string, any>, adapter: any, collection: any, service: AppointmentRequestService;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-26T10:00:00Z'));
    records = new Map();
    collection = {
      findOne: jest.fn(async (filter: any) => { const row = records.get(filter._id); return row?.customer_id === filter.customer_id ? row : null; }),
      updateOne: jest.fn(async (filter: any, update: any) => { const old = records.has(filter._id); if (!old) records.set(filter._id, { _id: filter._id, ...update.$setOnInsert }); return { upsertedCount: old ? 0 : 1 }; }),
    };
    adapter = { getAvailability: jest.fn().mockResolvedValue({ status: 'dates_with_capacity', checkedAt: '2026-11-26T09:00:00Z', dates: [{ date: '2026-11-27' }] }), getDataDatabase: jest.fn().mockResolvedValue({ collection: jest.fn().mockReturnValue(collection) }) };
    service = new AppointmentRequestService(adapter as AppointmentAvailabilityService);
  });
  afterEach(() => jest.useRealTimers());

  it('reads back a preferred time without saving, reserving or inventing time-slot availability', async () => {
    const result = await service.prepare(args, customer, context());
    expect(result.status).toBe('awaiting_caller_confirmation');
    expect(result.response).toContain('9:00 am');
    expect(result.response).toContain('not verified or reserved');
    expect(adapter.getDataDatabase).not.toHaveBeenCalled();
  });

  it('persists one request after a later explicit yes and safely handles retries', async () => {
    const draft = await service.prepare(args, customer, context());
    const saved = await service.confirm(draft.draftId, customer.customer_id, context('turn-2', 'Yes please'));
    expect(saved.status).toBe('saved_pending_service_confirmation');
    expect(records.size).toBe(1);
    const row = [...records.values()][0];
    expect(row).toMatchObject({ requested_date: '2026-11-27', preferred_time: '09:00', vehicle_rego: 'TEST01', status: 'pending_service_confirmation', booking_confirmed: false, time_slot_verified: false, capacity_reserved: false, pentana_booking_id: null, pentana_write_performed: false });
    expect(JSON.stringify(row)).not.toContain('test-private-call-token');
    adapter.getAvailability.mockResolvedValue({ status: 'stale', dates: [] });
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-3', 'Yes'))).status).toBe('saved_pending_service_confirmation');
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
  });

  it('rejects no, conditional yes, same-turn confirmation and other accounts or calls', async () => {
    const draft = await service.prepare(args, customer, context());
    for (const utterance of ['No', 'Yes but make it ten', 'Maybe', 'Yes if there is a loan car']) expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-2', utterance))).status).toBe('confirmation_required');
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-1', 'Yes'))).status).toBe('confirmation_required');
    expect((await service.confirm(draft.draftId, 'OTHER-CUSTOMER', context('turn-2', 'Yes'))).status).toBe('no_pending_request');
    expect((await service.confirm(draft.draftId, customer.customer_id, { ...context('turn-2', 'Yes'), callId: 'different-call' })).status).toBe('no_pending_request');
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('requires a new read-back when the caller changes their preferred time', async () => {
    const old = await service.prepare(args, customer, context());
    const changed = await service.prepare({ ...args, preferredTime: '10:00' }, customer, context('turn-2', 'Ten AM instead'));
    expect(changed.draftId).not.toBe(old.draftId);
    expect((await service.confirm(old.draftId, customer.customer_id, context('turn-3', 'Yes'))).status).toBe('no_pending_request');
    await service.confirm(changed.draftId, customer.customer_id, context('turn-3', 'Yes'));
    expect([...records.values()][0].preferred_time).toBe('10:00');
  });

  it('rechecks capacity before saving and reports database failures honestly', async () => {
    const draft = await service.prepare(args, customer, context());
    adapter.getAvailability.mockResolvedValueOnce({ status: 'stale', dates: [] });
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-2', 'Yes'))).status).toBe('capacity_changed');
    expect(collection.updateOne).not.toHaveBeenCalled();
    collection.updateOne.mockRejectedValueOnce(new Error('Network interruption'));
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-3', 'Yes'))).status).toBe('save_unverified');
  });

  it('validates the caller vehicle and time and expires abandoned drafts', async () => {
    expect((await service.prepare({ ...args, registration: 'OTHER' }, customer, context())).status).toBe('unverified_vehicle');
    expect((await service.prepare({ ...args, preferredTime: '25:30' }, customer, context())).status).toBe('needs_time');
    const draft = await service.prepare(args, customer, context());
    jest.advanceTimersByTime(11 * 60000);
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-2', 'Yes'))).status).toBe('no_pending_request');
    expect(records.size).toBe(0);
  });

  it('discards confirmation eligibility after a refusal or intervening question', async () => {
    const draft = await service.prepare(args, customer, context());
    service.beginTurn(context('turn-2', 'No do not save it'), customer.customer_id);
    expect(service.getPending(context('turn-3', 'Yes'), customer.customer_id)).toBeNull();
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-3', 'Yes'))).status).toBe('no_pending_request');
    expect(records.size).toBe(0);
  });

  it('recovers an uncertain write without inserting another request', async () => {
    const draft = await service.prepare(args, customer, context());
    collection.findOne.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Read-back connection lost'));
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-2', 'Yes'))).status).toBe('save_unverified');
    expect(records.size).toBe(1);
    expect((await service.confirm(draft.draftId, customer.customer_id, context('turn-3', 'Yes'))).status).toBe('saved_pending_service_confirmation');
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
  });

  it('only accepts explicit confirmation phrases without changed details', () => {
    expect(explicitRequestConfirmation("Yes, that's correct.")).toBe(true);
    expect(explicitRequestConfirmation('Yes at 10 instead')).toBe(false);
    expect(explicitRequestConfirmation('Can you check available slots')).toBe(false);
  });
});
