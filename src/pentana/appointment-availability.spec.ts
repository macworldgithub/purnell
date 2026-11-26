import { PentanaService } from './pentana.service';
import { AppointmentAvailabilityService } from './appointment-availability.service';
import { OpenAiService } from '../openai/openai.service';
import { CustomerDatabaseService } from '../customer-database/customer-database.service';

describe('Voice appointment capacity integration', () => {
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

  it('returns the factual capacity reply without a second model pass inventing times', async () => {
    const adapter = { getAvailability: jest.fn().mockResolvedValue({ status: 'dates_with_capacity', dates: [{ date: '2026-11-27' }], checkedAt: '2026-11-26T08:00:00Z' }) };
    const service = new OpenAiService(new PentanaService(adapter as unknown as AppointmentAvailabilityService), {} as CustomerDatabaseService);
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: 'capacity-test', type: 'function', function: { name: 'queryAppointmentSlots', arguments: '{}' } }] } }] });
    (service as any).openai.chat.completions.create = create;
    const result = await service.generateResponse([{ role: 'user', content: 'What service dates have capacity?' }], '', 'verified-test-customer');
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('daily Service capacity');
    expect(result.text).toContain('Service must confirm');
    expect(result.timings.toolCalls?.map(t => t.name)).toContain('queryAppointmentSlots');
  });
});
