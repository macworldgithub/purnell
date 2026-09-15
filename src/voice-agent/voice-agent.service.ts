import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  DeepgramService,
  DeepgramLiveSession,
} from '../deepgram/deepgram.service';
import { ElevenLabsService } from '../elevenlabs/elevenlabs.service';
import { OpenAiService } from '../openai/openai.service';
import { PentanaService } from '../pentana/pentana.service';
import {
  VOICE_AGENT_CONFIG,
  VoiceAgentConfig,
} from '../config/voice-agent.config';
import {
  HandoffRecord,
  PentanaCustomer,
  StaffMember,
  AppointmentSlot,
} from '../pentana/pentana.data';

import {
  CustomerDatabaseService,
  FullCustomerProfile,
} from '../customer-database/customer-database.service';
import { normalizeAustralianPhone } from '../common/utils/phone-normalizer';

function formatPhoneForSpeech(phone: string): string {
  if (!phone) return 'your number';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length >= 10) {
    digits = '0' + digits.slice(2);
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return phone;
}

export interface ConversationTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface VoiceAgentSession {
  sessionId: string;
  cli?: string;
  customerProfile?: FullCustomerProfile | null;
  history: ConversationTurn[];
  deepgramSession: DeepgramLiveSession | null;
  isSpeaking: boolean;
  activeAbortController: AbortController | null;
  currentTurnId: number;
  lastSpeechTime: number;
}

@Injectable()
export class VoiceAgentService {
  private readonly logger = new Logger(VoiceAgentService.name);
  private activeSessions = new Map<string, VoiceAgentSession>();

  constructor(
    private readonly deepgramService: DeepgramService,
    private readonly elevenLabsService: ElevenLabsService,
    private readonly openAiService: OpenAiService,
    private readonly pentanaService: PentanaService,
    private readonly customerDatabaseService: CustomerDatabaseService,
  ) {
    this.logger.log('VoiceAgentService Orchestrator initialized');
  }

  /**
   * Get full voice agent configuration
   */
  getConfig(): VoiceAgentConfig {
    return VOICE_AGENT_CONFIG;
  }

  /**
   * Get formatted System Prompt and Knowledge Base content
   */
  getFormattedSystemPrompt(): string {
    return this.openAiService.getSystemPrompt();
  }

  /**
   * Helper to format verified customer context for OpenAI system prompt injection
   */
  formatCustomerContextForPrompt(
    profile?: FullCustomerProfile | null,
    cli?: string,
  ): string {
    if (!profile || !profile.customer) {
      return [
        'CALLER IDENTIFICATION STATUS: Unidentified / Ambiguous',
        `INCOMING PHONE (CLI): ${cli || 'Unknown'}`,
        'INSTRUCTION: If caller states their name, vehicle registration plate, or phone number, use the "lookupPentanaCustomer" tool to fetch their full record from Pentana.',
      ].join('\n');
    }

    const c = profile.customer;
    const vehicles = (c.vehicles || [])
      .map(
        (v) =>
          `- ${v.year || ''} ${v.make || ''} ${v.model || ''} (Rego: ${v.rego || 'N/A'}, VIN: ${v.vin || 'N/A'}, Colour: ${v.colour || 'N/A'})`,
      )
      .join('\n  ');

    const ros = (profile.repair_orders || [])
      .map(
        (ro) =>
          `- RO #${ro.ro_number}: Rego ${ro.vehicle_rego} | Status: "${ro.status}" | Advisor: ${ro.advisor} | Drop-off: ${ro.drop_off_date} | Ready for Collection: ${ro.ready_for_collection ? 'YES' : 'NO'} | Awaiting Approval: ${ro.awaiting_approval ? 'YES' : 'NO'}`,
      )
      .join('\n  ');

    const bookings = (profile.service_bookings || [])
      .map(
        (bk) =>
          `- Booking on ${bk.date} at ${bk.time} (${bk.job_type}) with Advisor ${bk.advisor} (Rego: ${bk.vehicle_rego || 'On file'})`,
      )
      .join('\n  ');

    const parts = (profile.parts_orders || [])
      .map((pt) => {
        const lineDesc =
          pt.lines && pt.lines.length > 0
            ? pt.lines.map((l) => `${l.description || 'Part'} (Status: ${l.status}, Arrived: ${l.arrived ? 'YES' : 'NO'})`).join(', ')
            : 'Parts on order';
        return `- Parts Order #${pt.parts_order_id} (RO: ${pt.ro_number || 'N/A'}, Rego: ${pt.vehicle_rego}): ${lineDesc}`;
      })
      .join('\n  ');

    const contacts = profile.authorised_contacts
      ? (profile.authorised_contacts.authorised_third_parties || [])
          .map(
            (ct) =>
              `- ${ct.name} (${ct.relationship}): ${ct.mobile} [Authorised for: ${(ct.authorised_for || []).join(', ') || 'General'}]`,
          )
          .join('\n  ')
      : 'None listed';

    const primaryVehicle = c.vehicles && c.vehicles.length > 0 ? c.vehicles[0] : null;

    return [
      'CALLER IDENTIFICATION STATUS: VERIFIED / HIGH CONFIDENCE',
      `CUSTOMER ID: ${c.customer_id}`,
      `CUSTOMER NAME: ${c.customer_name} (Preferred: ${c.preferred_name || c.customer_name})`,
      `MOBILE: ${c.mobile || 'N/A'} | LANDLINE: ${c.landline || 'N/A'}`,
      `ASSIGNED SERVICE ADVISOR: ${primaryVehicle?.assigned_advisor || 'Service Team'}`,
      `ASSIGNED SALES CONSULTANT: ${primaryVehicle?.assigned_sales || 'Sales Team'}`,
      `REGISTERED VEHICLES:\n  ${vehicles || 'None listed'}`,
      `OPEN REPAIR ORDERS (RO):\n  ${ros || 'No open repair orders'}`,
      `UPCOMING SERVICE BOOKINGS:\n  ${bookings || 'No upcoming bookings'}`,
      `PARTS ORDERS:\n  ${parts || 'No parts orders on file'}`,
      `AUTHORISED CONTACTS:\n  ${contacts}`,
      'OPERATIONAL INSTRUCTIONS:',
      '1. You already have this client verified in CRM memory across all turns. NEVER lose or forget this context.',
      '2. Answer inquiries about vehicle status, service bookings, parts, and advisors directly using the above data.',
      '3. Be natural, concise, and professional. Confirm name and clarify requests without reciting the whole database at once.',
    ].join('\n');
  }

  /**
   * Initialize a voice agent streaming session for a connected WebSocket client
   */
  async createSession(
    sessionId: string,
    callbacks: {
      onTranscript: (transcript: string, isFinal: boolean) => void;
      onAiReply: (text: string, toolLogs?: string[]) => void;
      onAudioChunk: (chunk: Buffer) => void;
      onBargeIn: () => void;
    },
  ): Promise<VoiceAgentSession> {
    const session: VoiceAgentSession = {
      sessionId,
      history: [],
      deepgramSession: null,
      isSpeaking: false,
      activeAbortController: null,
      currentTurnId: 0,
      lastSpeechTime: Date.now(),
    };

    // Initialize Deepgram live STT session
    session.deepgramSession =
      await this.deepgramService.createLiveTranscriptionSession({
        onTranscript: (transcript: string, isFinal: boolean) => {
          callbacks.onTranscript(transcript, isFinal);

          // If user is actively speaking while agent was speaking, interrupt immediately
          if (session.isSpeaking) {
            this.handleBargeIn(session, callbacks.onBargeIn);
          }

          if (isFinal && transcript.trim().length > 0) {
            void this.processUserSpeech(session, transcript, callbacks);
          }
        },
        onSpeechStarted: () => {
          // Immediate interruption as soon as user starts speaking
          if (session.isSpeaking) {
            this.handleBargeIn(session, callbacks.onBargeIn);
          }
        },
        onError: (err: unknown) => {
          this.logger.error(`Session ${sessionId} STT error:`, err);
        },
        onClose: () => {
          this.logger.log(`Session ${sessionId} STT closed`);
        },
      });

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Triggers initial backend voice agent greeting & audio stream for a new session
   */
  async sendInitialGreeting(
    sessionId: string,
    cli: string,
    callbacks: {
      onAiReply: (text: string, toolLogs?: string[]) => void;
      onAudioChunk: (chunk: Buffer) => void;
    },
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    const normalizedCli = normalizeAustralianPhone(cli || '');
    // Lookup customer profile in MongoDB Atlas
    const profile = normalizedCli
      ? await this.customerDatabaseService.getFullCustomerProfile(
          normalizedCli,
        )
      : null;

    if (session) {
      session.cli = normalizedCli;
      session.customerProfile = profile;
    }

    const spokenCli = formatPhoneForSpeech(cli || normalizedCli);

    let greetingText = '';
    if (profile && profile.customer) {
      const c = profile.customer;
      const preferred = c.preferred_name || c.customer_name;
      greetingText = `Purnell Motors, Blakehurst. I see you're calling from ${spokenCli}, registered to ${c.customer_name}. Am I speaking with ${preferred} today, and how may I assist you with your vehicle?`;
    } else {
      greetingText = `Good morning, Purnell Motors, Blakehurst. May I have your name and vehicle registration so I can pull up your file, and how may I assist you today?`;
    }

    if (session) {
      session.history.push({ role: 'assistant', content: greetingText });
    }
    callbacks.onAiReply(greetingText);

    try {
      if (VOICE_AGENT_CONFIG.elevenlabs.apiKey) {
        const turnId = session ? ++session.currentTurnId : 1;
        const abortCtrl = new AbortController();
        if (session) {
          session.activeAbortController = abortCtrl;
          session.isSpeaking = true;
        }

        await this.elevenLabsService.streamSpeech(
          greetingText,
          (chunk) => {
            if (!abortCtrl.signal.aborted) {
              callbacks.onAudioChunk(chunk);
            }
          },
          abortCtrl.signal,
        );

        if (session && session.currentTurnId === turnId) {
          session.isSpeaking = false;
          session.activeAbortController = null;
        }
      }
    } catch (err) {
      this.logger.warn(`Initial greeting TTS failed: ${String(err)}`);
    }
  }

  /**
   * Generates initial greeting with customer lookup and ElevenLabs TTS audio for HTTP/REST sessions
   */
  async generateInitialGreeting(cli: string): Promise<{
    text: string;
    audioBuffer?: string;
    customer?: any;
  }> {
    const normalizedCli = normalizeAustralianPhone(cli || '');
    const displayCli = normalizedCli || 'your number';

    const profile = normalizedCli
      ? await this.customerDatabaseService.getFullCustomerProfile(
          normalizedCli,
        )
      : null;

    const spokenCli = formatPhoneForSpeech(cli || normalizedCli);

    let greetingText = '';
    if (profile && profile.customer) {
      const c = profile.customer;
      const preferred = c.preferred_name || c.customer_name;
      greetingText = `Purnell Motors, Blakehurst. I see you're calling from ${spokenCli}, registered to ${c.customer_name}. Am I speaking with ${preferred} today, and how may I assist you with your vehicle?`;
    } else {
      greetingText = `Good morning, Purnell Motors, Blakehurst. May I have your name and vehicle registration so I can pull up your file, and how may I assist you today?`;
    }

    let audioBase64: string | undefined;
    try {
      if (VOICE_AGENT_CONFIG.elevenlabs.apiKey) {
        const pcmBuffer =
          await this.elevenLabsService.generateSpeechBuffer(greetingText);
        audioBase64 = pcmBuffer.toString('base64');
      }
    } catch (err: unknown) {
      this.logger.warn(
        `TTS generation failed for initial greeting: ${String(err)}`,
      );
    }

    return {
      text: greetingText,
      audioBuffer: audioBase64,
      customer: profile,
    };
  }

  /**
   * Immediately aborts active voice agent speech when the caller interrupts
   */
  private handleBargeIn(
    session: VoiceAgentSession,
    onBargeInCallback: () => void,
  ) {
    this.logger.log(
      `[Barge-In] Interrupting voice agent speech for session ${session.sessionId} (Turn #${session.currentTurnId})`,
    );

    // Cancel active ElevenLabs HTTP stream
    if (session.activeAbortController) {
      session.activeAbortController.abort();
      session.activeAbortController = null;
    }

    session.isSpeaking = false;
    session.currentTurnId++; // Invalidate any buffered audio chunks in flight

    // Notify client over WebSocket to immediately mute/flush speaker buffer
    onBargeInCallback();
  }

  /**
   * Process incoming user audio chunk from WebSocket
   */
  handleAudioChunk(
    sessionId: string,
    chunk: Buffer | ArrayBuffer | Uint8Array,
  ) {
    const session = this.activeSessions.get(sessionId);
    if (session?.deepgramSession) {
      session.deepgramSession.sendAudio(chunk);
    }
  }

  /**
   * Process finalized user speech transcript
   */
  private async processUserSpeech(
    session: VoiceAgentSession,
    userText: string,
    callbacks: {
      onAiReply: (text: string, toolLogs?: string[]) => void;
      onAudioChunk: (chunk: Buffer) => void;
      onBargeIn: () => void;
    },
  ): Promise<void> {
    session.history.push({ role: 'user', content: userText });

    // Build messages from history
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      session.history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

    // Inject verified caller context into OpenAI system prompt
    const customerContext = this.formatCustomerContextForPrompt(
      session.customerProfile,
      session.cli,
    );

    try {
      const { text: aiReply, toolLogs } =
        await this.openAiService.generateResponse(
          messages,
          customerContext,
        );
      session.history.push({ role: 'assistant', content: aiReply });

      callbacks.onAiReply(aiReply, toolLogs);

      // Start new TTS turn with dedicated AbortController
      const thisTurnId = ++session.currentTurnId;
      const abortController = new AbortController();
      session.activeAbortController = abortController;
      session.isSpeaking = true;
      session.lastSpeechTime = Date.now();

      await this.elevenLabsService.streamSpeech(
        aiReply,
        (chunk) => {
          // Verify turn hasn't been interrupted
          if (
            session.isSpeaking &&
            session.currentTurnId === thisTurnId &&
            !abortController.signal.aborted
          ) {
            callbacks.onAudioChunk(chunk);
          }
        },
        abortController.signal,
      );

      if (session.currentTurnId === thisTurnId) {
        session.isSpeaking = false;
        session.activeAbortController = null;
      }
    } catch (error: unknown) {
      this.logger.error(
        `Error processing speech turn for session ${session.sessionId}:`,
        error,
      );
      session.isSpeaking = false;
      session.activeAbortController = null;
    }
  }

  /**
   * Process a text message directly (for REST testing)
   */
  async processTextMessage(
    userText: string,
    history: ConversationTurn[] = [],
    cli: string = '',
  ): Promise<{ text: string; toolLogs?: string[]; audioBuffer?: string }> {
    const normalizedCli = normalizeAustralianPhone(cli || '');
    const profile = normalizedCli
      ? await this.customerDatabaseService.getFullCustomerProfile(
          normalizedCli,
        )
      : null;

    const customerContext = this.formatCustomerContextForPrompt(
      profile,
      normalizedCli,
    );

    const fullHistory: ConversationTurn[] = [
      ...history,
      { role: 'user', content: userText },
    ];
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      fullHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const result = await this.openAiService.generateResponse(
      messages,
      customerContext,
    );

    let audioBase64: string | undefined;
    try {
      if (VOICE_AGENT_CONFIG.elevenlabs.apiKey) {
        const pcmBuffer = await this.elevenLabsService.generateSpeechBuffer(
          result.text,
        );
        audioBase64 = pcmBuffer.toString('base64');
      }
    } catch (err: unknown) {
      this.logger.warn(
        `TTS generation skipped in test text message: ${String(err)}`,
      );
    }

    return {
      text: result.text,
      toolLogs: result.toolLogs,
      audioBuffer: audioBase64,
    };
  }

  /**
   * End and cleanup session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      if (session.activeAbortController) {
        session.activeAbortController.abort();
      }
      if (session.deepgramSession) {
        await session.deepgramSession.finish();
      }
      this.activeSessions.delete(sessionId);
      this.logger.log(`Session ${sessionId} destroyed`);
    }
  }

  /**
   * Pentana Service helpers
   */
  lookupCustomer(query: string): PentanaCustomer | null {
    return this.pentanaService.searchCustomer(query);
  }

  checkStaff(name: string): StaffMember | null {
    return this.pentanaService.checkStaff(name);
  }

  getAppointmentSlots(): AppointmentSlot[] {
    return this.pentanaService.getAppointmentSlots();
  }

  createHandoff(record: Partial<HandoffRecord>): string {
    return this.pentanaService.formatHandoffRecord(record);
  }
}
