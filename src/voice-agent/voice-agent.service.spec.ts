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

  it('delegates text to the configured reasoning model without generating speech', async () => {
    customerDatabase.getFullCustomerProfile.mockResolvedValue(null);

    const result = await service.processTextMessage('Can I check an appointment?', [], '');

    expect(result.text).toBe('I can help with that.');
    expect(result.timings.llmTotalMs).toEqual(expect.any(Number));
    expect(openAi.generateResponse).toHaveBeenCalledTimes(1);
  });
});
