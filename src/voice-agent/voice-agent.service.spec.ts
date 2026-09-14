import { Test, TestingModule } from '@nestjs/testing';
import { VoiceAgentService } from './voice-agent.service';
import { VoiceAgentModule } from './voice-agent.module';
import { PentanaService } from '../pentana/pentana.service';
import { ROADSIDE_ASSISTANCE, SITE_ROUTING } from '../pentana/pentana.data';

describe('VoiceAgentModule & Interruption Handling Tests', () => {
  let service: VoiceAgentService;
  let pentanaService: PentanaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [VoiceAgentModule],
    }).compile();

    service = module.get<VoiceAgentService>(VoiceAgentService);
    pentanaService = module.get<PentanaService>(PentanaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(pentanaService).toBeDefined();
  });

  describe('Configuration Parameters', () => {
    it('should have exact ElevenLabs flash v2.5 settings', () => {
      const config = service.getConfig();
      expect(config.elevenlabs.model).toBe('eleven_flash_v2_5');
      expect(config.elevenlabs.outputFormat).toBe('pcm_16000');
      expect(config.elevenlabs.voiceSettings.stability).toBe(0.5);
      expect(config.elevenlabs.voiceSettings.similarity_boost).toBe(0.75);
      expect(config.elevenlabs.voiceSettings.style).toBe(0.2);
      expect(config.elevenlabs.voiceSettings.use_speaker_boost).toBe(true);
    });

    it('should have exact OpenAI VAD & brain parameters', () => {
      const config = service.getConfig();
      expect(config.openai.model).toBe('gpt-realtime-2');
      expect(config.openai.vad.threshold).toBe(0.7);
      expect(config.openai.vad.prefix_padding_ms).toBe(300);
      expect(config.openai.vad.silence_duration_ms).toBe(1000);
      expect(config.openai.vad.barge_in_grace_ms).toBe(500);
    });

    it('should have exact Deepgram STT settings', () => {
      const config = service.getConfig();
      expect(config.deepgram.model).toBe('nova-2');
      expect(config.deepgram.language).toBe('en');
      expect(config.deepgram.encoding).toBe('linear16');
      expect(config.deepgram.sample_rate).toBe(16000);
    });
  });

  describe('Simulated Pentana Data Lookups', () => {
    it('should find Sarah Thornton with open RO and arrived brake parts', () => {
      const customer = pentanaService.searchCustomer('0412 345 678');
      expect(customer).toBeDefined();
      expect(customer?.name).toBe('Sarah Thornton');
      expect(customer?.vehicle).toBe('2023 Range Rover Sport');
      expect(customer?.rego).toBe('XYZ-001');
      expect(customer?.partsStatus).toContain('Part #BR-994 — ARRIVED');
    });

    it('should find David Nguyen by rego', () => {
      const customer = pentanaService.searchCustomer('DEF-220');
      expect(customer).toBeDefined();
      expect(customer?.name).toBe('David Nguyen');
      expect(customer?.nextAppointment).toBe('15 Sep @ 9:00 AM');
    });

    it('should return correct staff availability status', () => {
      expect(pentanaService.checkStaff('Kamal')?.status).toBe('Available');
      expect(pentanaService.checkStaff('Jacob')?.status).toBe(
        'On another call',
      );
      expect(pentanaService.checkStaff('Paul')?.status).toBe('Away from desk');
      expect(pentanaService.checkStaff('Amina')?.status).toBe('Available');
    });

    it('should return available appointment slots', () => {
      const slots = pentanaService.getAppointmentSlots();
      expect(slots.length).toBeGreaterThanOrEqual(5);
      expect(slots[0].date).toBe('Tuesday 16 Sep');
    });
  });

  describe('Roadside Assistance & Safety Numbers', () => {
    it('should provide correct safety emergency roadside numbers', () => {
      expect(ROADSIDE_ASSISTANCE['Land Rover']).toBe('1800 808 180');
      expect(ROADSIDE_ASSISTANCE['Range Rover']).toBe('1800 808 180');
      expect(ROADSIDE_ASSISTANCE['Defender']).toBe('1800 808 180');
      expect(ROADSIDE_ASSISTANCE['Jaguar']).toBe('1800 819 181');
    });
  });

  describe('Brand Site Routing', () => {
    it('should route Jaecoo and INEOS to 996 King Georges Rd', () => {
      expect(SITE_ROUTING.jaecoo.address).toContain('996 King Georges Road');
    });

    it('should route Jaguar and Land Rover to 990 King Georges Rd', () => {
      expect(SITE_ROUTING.jlr.address).toContain('990 King Georges Road');
    });
  });

  describe('Handoff Record Formatting', () => {
    it('should format an auditable handoff record with required fields', () => {
      const record = pentanaService.formatHandoffRecord({
        intentLabel: 'Book a Service',
        callerName: 'John Smith',
        callbackNumber: '0499 123 456',
        vehicle: 'Defender 110 (DEF-999)',
        reason: 'Urgent transmission warning light',
        urgency: 'Safety',
        destination: 'Aftersales / Kamal',
        transferAttempted: 'No',
        transferOutcome: 'Callback created',
        sourceContext: 'After-hours inquiry',
        promisedCallbackWindow: 'Monday 8:30 AM',
      });

      expect(record).toContain('HANDOFF RECORD');
      expect(record).toContain('Caller name: John Smith');
      expect(record).toContain('Urgency: Safety');
      expect(record).toContain('Destination: Aftersales / Kamal');
    });
  });

  describe('System Prompt and Knowledge Base Formatting', () => {
    it('should load and compile System Prompt and KB into unified instructions', () => {
      const prompt = service.getFormattedSystemPrompt();
      expect(prompt).toContain('Purnell Motors Pty Ltd');
      expect(prompt).toContain('Blakehurst, NSW');
      expect(prompt).toContain('1800 808 180');
      expect(prompt).toContain('1800 819 181');
      expect(prompt).toContain('996 King Georges Road');
      expect(prompt).toContain('990 King Georges Road');
      expect(prompt).toContain('[PENTANA LOOKUP — simulated]');
    });
  });
});
