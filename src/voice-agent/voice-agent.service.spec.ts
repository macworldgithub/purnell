import { Test, TestingModule } from '@nestjs/testing';
import { CustomerDatabaseService, FullCustomerProfile } from '../customer-database/customer-database.service';
import { OpenAiService } from '../openai/openai.service';
import { VoiceAgentService } from './voice-agent.service';

describe('VoiceAgentService GPT-Live backend', () => {
  let service: VoiceAgentService;
  let customerDatabase: { getFullCustomerProfile: any };
  let openAi: { generateResponse: any };

  beforeEach(async () => {
    customerDatabase = { getFullCustomerProfile: jest.fn() };
    openAi = {
      generateResponse: jest.fn().mockResolvedValue({
        text: 'I can help with that.',
        toolLogs: [],
        timings: { totalMs: 20, iterations: 1, llmCallsMs: [20], toolCalls: [] },
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceAgentService,
        { provide: CustomerDatabaseService, useValue: customerDatabase },
        { provide: OpenAiService, useValue: openAi },
      ],
    }).compile();
    service = module.get(VoiceAgentService);
  });

  it('greets a caller whose number matches a customer record', async () => {
    customerDatabase.getFullCustomerProfile.mockResolvedValue({
      customer: { customer_name: 'Jordan Lee', preferred_name: 'Jordan' },
    } as unknown as FullCustomerProfile);

    const context = await service.getLiveCallerContext('0412000006');

    expect(context.callerKnown).toBe(true);
    expect(context.greeting).toContain('Jordan');
  });

  it('asks an unknown caller for registration details to verify their account', async () => {
    customerDatabase.getFullCustomerProfile.mockResolvedValue(null);

    const context = await service.getLiveCallerContext('');

    expect(context.callerKnown).toBe(false);
    expect(context.greeting).toContain('Our voice service is available to registered customers');
    expect(context.greeting).toContain('May I have your full name and vehicle registration');
  });

  it('keeps verification across follow-up requests using the server call token', async () => {
    const profile = {
      customer: { customer_id: 'C1', customer_name: 'Test Customer', vehicles: [] },
      repair_orders: [{ ro_number: 'L3521', vehicle_rego: 'KLP', status: 'OPEN', advisor: 'Kamal' }],
    };
    customerDatabase.getFullCustomerProfile.mockImplementation(async (key: string) => key === 'C1' ? profile : null);
    openAi.generateResponse.mockImplementation(async (_messages: unknown, _context: unknown, _id: unknown, verified: (id: string) => void) => {
      if (_id === 'C1') return { text: 'Your repair order is L 3 5 2 1.' };
      verified('C1');
      return { text: 'Untrusted free-form model answer' };
    });
    const token = service.createCall('');
    const first = await service.processTextMessage('Test Customer KLP', [], '', token);
    const second = await service.processTextMessage('What is the repair order?', [], '', token);
    expect(first.text).toBe('Thanks, I’ve verified your account. How can I help?');
    expect(second.text).toContain('L 3 5 2 1');
    expect(openAi.generateResponse).toHaveBeenCalledTimes(2);
    expect(openAi.generateResponse.mock.calls[1][2]).toBe('C1');
    await expect(service.processTextMessage('status', [], '', 'invalid')).rejects.toThrow('expired');
  });

  it('delegates a new booking for a different vehicle without appending repair details', async () => {
    customerDatabase.getFullCustomerProfile.mockResolvedValue({
      customer: { customer_id: 'C1', customer_name: 'Test Customer', vehicles: [] },
      repair_orders: [{ ro_number: 'L3521', vehicle_rego: 'KLP', status: 'OPEN', pentana_snapshot: '2026-10-26' }],
    });
    openAi.generateResponse.mockResolvedValueOnce({
      text: 'For tomorrow morning, would you like to speak with our Service team?',
    });
    const history = [{ role: 'user' as const, content: 'Can I book tomorrow morning?' }];
    const result = await service.processTextMessage('It is for a different vehicle.', history, '0412000006');

    expect(result.text).toBe('For tomorrow morning, would you like to speak with our Service team?');
    expect(openAi.generateResponse).toHaveBeenCalledWith(
      [...history, { role: 'user', content: 'It is for a different vehicle.' }],
      expect.stringContaining('"snapshotDate":"2026-10-26"'),
      'C1',
      expect.any(Function),
      undefined,
    );
  });

  it('delegates text to the configured reasoning model without generating speech', async () => {
    customerDatabase.getFullCustomerProfile.mockResolvedValue(null);

    const result = await service.processTextMessage('Can I check an appointment?', [], '');

    expect(result.text).toContain('verify the account');
    expect(result.timings.llmTotalMs).toEqual(expect.any(Number));
    expect(openAi.generateResponse).toHaveBeenCalledTimes(1);
  });
});
