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

export interface ConversationTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface VoiceAgentSession {
  sessionId: string;
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
    callbacks: {
      onAiReply: (text: string, toolLogs?: string[]) => void;
      onAudioChunk: (chunk: Buffer) => void;
    },
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    const greetingText =
      'Welcome to Purnell Motors! I am your AI receptionist. How can I assist you with your vehicle today?';

    if (session) {
      session.history.push({ role: 'assistant', content: greetingText });
    }

    callbacks.onAiReply(greetingText);

    try {
      if (VOICE_AGENT_CONFIG.elevenlabs.apiKey) {
        const thisTurnId = session ? ++session.currentTurnId : 1;
        const abortController = new AbortController();
        if (session) {
          session.activeAbortController = abortController;
          session.isSpeaking = true;
        }

        await this.elevenLabsService.streamSpeech(
          greetingText,
          (chunk) => {
            if (!abortController.signal.aborted) {
              callbacks.onAudioChunk(chunk);
            }
          },
          abortController.signal,
        );

        if (session && session.currentTurnId === thisTurnId) {
          session.isSpeaking = false;
          session.activeAbortController = null;
        }
      }
    } catch (err) {
      this.logger.warn(`Initial greeting TTS failed: ${String(err)}`);
    }
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

    // Call OpenAI brain with updated history
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      session.history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

    try {
      const { text: aiReply, toolLogs } =
        await this.openAiService.generateResponse(messages);
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
  ): Promise<{ text: string; toolLogs?: string[]; audioBuffer?: string }> {
    const fullHistory: ConversationTurn[] = [
      ...history,
      { role: 'user', content: userText },
    ];
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      fullHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const result = await this.openAiService.generateResponse(messages);

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
