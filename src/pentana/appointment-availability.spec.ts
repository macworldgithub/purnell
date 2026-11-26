import { PentanaService } from './pentana.service';
import { AppointmentAvailabilityService, appointmentDatabaseConfig } from './appointment-availability.service';
import { OpenAiService } from '../openai/openai.service';
import { CustomerDatabaseService } from '../customer-database/customer-database.service';

describe('Voice appointment capacity integration', () => {
  it('executes a pending confirmation without asking the model to choose a save tool', async () => {
    const pentana = new PentanaService();
    jest.spyOn(pentana, 'getPendingAppointmentRequest').mockReturnValue({
      draftId: 'server-draft', date: '2026-11-27', preferredTime: '12:00',
      registration: 'RW112', reason: 'service',
    });
    const save = jest.spyOn(pentana, 'confirmAppointmentRequest').mockResolvedValue({
      status: 'saved_pending_service_confirmation', response: 'Saved request server-draft, pending Service confirmation.',
    });
    const service = new OpenAiService(pentana, {} as CustomerDatabaseService);
    const create = jest.fn();
    (service as any).openai.chat.completions.create = create;
    const context = { callId: 'test-call', turnId: 'confirm-turn', callerText: 'Yes' };
    const result = await service.generateResponse([{ role: 'user', content: 'Yes' }], '', 'C1', undefined, context);
    expect(save).toHaveBeenCalledWith('server-draft', 'C1', context);
    expect(create).not.toHaveBeenCalled();
    expect(result.text).toContain('Saved request server-draft');
  });
  it('uses the configured app database when a dedicated capacity connection is absent', () => {
    expect(appointmentDatabaseConfig({ MONGO_URI: 'mongodb://app', MONGO_DB_NAME: 'app-db' }, {}))
      .toEqual({ uri: 'mongodb://app', dbName: 'app-db' });
    expect(appointmentDatabaseConfig({ MONGO_URI: 'mongodb://app' }, {}).dbName)
      .toBe('Purnell_Pentana_VoiceAgent');
  });
  it('preserves dedicated capacity connection precedence', () => {
    expect(appointmentDatabaseConfig({ MONGO_URI: 'mongodb://app', ERAPOWER_DATA_MONGO_URI: 'mongodb://capacity' }, {}).uri)
      .toBe('mongodb://capacity');
    expect(appointmentDatabaseConfig({ MONGO_URI: 'mongodb://app' }, { PURNELL_COPY_TARGET_URI: 'mongodb://sync' }).uri)
      .toBe('mongodb://sync');
  });
  it('passes preferred dates to the real capacity adapter and returns its metadata', async () => {
    const result = { status: 'dates_with_capacity', dates: [{ date: '2026-11-27' }], exactTimeSlotsVerified: false, checkedAt: '2026-11-26T08:00:00Z' };
    const adapter = { getAvailability: jest.fn().mockResolvedValue(result) };
    const pentana = new PentanaService(adapter as unknown as AppointmentAvailabilityService);
    const openai = new OpenAiService(pentana, {} as CustomerDatabaseService);
    const actual = JSON.parse(await openai.executeToolCall('queryAppointmentSlots', { preferredDay: 'tomorrow' }));
    expect(actual).toEqual(result);
    expect(adapter.getAvailability).toHaveBeenCalledWith('tomorrow');
    expect(actual).not.toHaveProperty('slots');
  });

  it('fails closed when no capacity adapter is configured', async () => {
    const result = await new PentanaService().getAppointmentSlots();
    expect(result.status).toBe('unavailable');
    expect(result.dates).toEqual([]);
  });

  it('checks the earliest dates for an early appointment rather than an inferred tomorrow', async () => {
    const adapter = { getAvailability: jest.fn().mockResolvedValue({ status: 'dates_with_capacity', dates: [] }) };
    const service = new OpenAiService(new PentanaService(adapter as unknown as AppointmentAvailabilityService), {} as CustomerDatabaseService);
    await service.executeToolCall('queryAppointmentSlots', { preferredDay: 'tomorrow' }, 'verified-customer', { callId: 'test', turnId: 'turn', callerText: 'Can you please tell me if I can get an early appointment' });
    expect(adapter.getAvailability).toHaveBeenLastCalledWith(undefined);
    await service.executeToolCall('queryAppointmentSlots', { preferredDay: 'tomorrow' }, 'verified-customer', { callId: 'test', turnId: 'turn', callerText: 'Can I get an early appointment tomorrow?' });
    expect(adapter.getAvailability).toHaveBeenLastCalledWith('tomorrow');
  });

  it('returns the factual capacity reply without a second model pass inventing times', async () => {
    const adapter = { getAvailability: jest.fn().mockResolvedValue({ status: 'dates_with_capacity', dates: [{ date: '2026-11-27' }], checkedAt: '2026-11-26T08:00:00Z' }) };
    const service = new OpenAiService(new PentanaService(adapter as unknown as AppointmentAvailabilityService), {} as CustomerDatabaseService);
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: 'capacity-test', type: 'function', function: { name: 'queryAppointmentSlots', arguments: '{}' } }] } }] });
    (service as any).openai.chat.completions.create = create;
    const result = await service.generateResponse([{ role: 'user', content: 'What service dates have capacity?' }], '', 'verified-test-customer');
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('Recorded capacity');
    expect(result.text).toContain('Service must confirm');
    expect(result.timings.toolCalls?.map(t => t.name)).toContain('queryAppointmentSlots');
  });

  it('requires an availability tool call for the reported new-booking wording', async () => {
    const adapter = { getAvailability: jest.fn().mockResolvedValue({ status: 'dates_with_capacity', dates: [{ date: '2026-11-27' }], checkedAt: '2026-11-26T10:00:00Z' }) };
    const service = new OpenAiService(new PentanaService(adapter as unknown as AppointmentAvailabilityService), {} as CustomerDatabaseService);
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: 'new-booking-test', type: 'function', function: { name: 'queryAppointmentSlots', arguments: '{"preferredDay":"tomorrow"}' } }] } }] });
    (service as any).openai.chat.completions.create = create;
    const result = await service.generateResponse([{ role: 'user', content: 'Can I book a new appointment tomorrow?' }], '', 'verified-customer');
    expect(create.mock.calls[0][0].tool_choice.function.name).toBe('queryAppointmentSlots');
    expect(adapter.getAvailability).toHaveBeenCalledWith('tomorrow');
    expect(result.text).toContain('What time would you prefer?');
    expect(result.text).not.toContain('cannot check');
  });
});
