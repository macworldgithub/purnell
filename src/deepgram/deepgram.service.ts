import { Injectable, Logger } from '@nestjs/common';
import { DeepgramClient } from '@deepgram/sdk';
import { VOICE_AGENT_CONFIG } from '../config/voice-agent.config';

export interface DeepgramSessionCallbacks {
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onSpeechStarted?: () => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}

export interface DeepgramLiveSession {
  sendAudio: (chunk: Buffer | ArrayBuffer | Uint8Array) => void;
  finish: () => Promise<void>;
}

interface DeepgramAlternative {
  transcript?: string;
  confidence?: number;
}

interface DeepgramChannel {
  alternatives?: DeepgramAlternative[];
}

interface DeepgramMessageEvent {
  type?: string;
  channel?: DeepgramChannel;
  is_final?: boolean;
  speech_final?: boolean;
  speech_started?: boolean;
}

interface LiveSocketInterface {
  on(event: string, listener: (data: unknown) => void): void;
  connect(): void;
  waitForOpen?(): Promise<void>;
  sendMedia?(chunk: unknown): void;
  send?(chunk: unknown): void;
  close?(): void;
}

@Injectable()
export class DeepgramService {
  private readonly logger = new Logger(DeepgramService.name);
  private deepgramClient: DeepgramClient;

  constructor() {
    const apiKey = VOICE_AGENT_CONFIG.deepgram.apiKey;
    this.deepgramClient = new DeepgramClient({ apiKey });
    this.logger.log('Deepgram STT Service initialized (Model: nova-2)');
  }

  /**
   * Creates a real-time live transcription connection with Deepgram Nova-2
   */
  async createLiveTranscriptionSession(
    callbacks: DeepgramSessionCallbacks,
  ): Promise<DeepgramLiveSession> {
    try {
      const socket = (await this.deepgramClient.listen.v1.createConnection({
        model: VOICE_AGENT_CONFIG.deepgram.model,
        language: VOICE_AGENT_CONFIG.deepgram.language,
        smart_format: 'true',
        encoding: VOICE_AGENT_CONFIG.deepgram.encoding,
        sample_rate: VOICE_AGENT_CONFIG.deepgram.sample_rate,
      })) as unknown as LiveSocketInterface;

      let lastSpeechStartTime = 0;

      socket.on('message', (raw: unknown) => {
        const data = raw as DeepgramMessageEvent;
        if (
          data &&
          data.type === 'Results' &&
          data.channel?.alternatives?.[0]
        ) {
          const transcript: string =
            data.channel.alternatives[0].transcript || '';
          const isFinal = Boolean(data.is_final || data.speech_final);

          if (transcript.trim().length > 0) {
            if (callbacks.onSpeechStarted) {
              callbacks.onSpeechStarted();
            }
            if (isFinal) {
              const sttDuration = lastSpeechStartTime ? `${Date.now() - lastSpeechStartTime}ms` : 'stream';
              this.logger.log(
                `[Deepgram STT] Final transcript received (${sttDuration}): "${transcript.trim()}"`,
              );
            }
            callbacks.onTranscript(transcript, isFinal);
          }
        } else if (
          data &&
          (data.type === 'SpeechStarted' || data.speech_started)
        ) {
          lastSpeechStartTime = Date.now();
          this.logger.log('[Deepgram STT] User speech started detected');
          if (callbacks.onSpeechStarted) {
            callbacks.onSpeechStarted();
          }
        }
      });

      socket.on('error', (err: unknown) => {
        this.logger.error('Deepgram STT connection error:', err);
        if (callbacks.onError) {
          callbacks.onError(err);
        }
      });

      socket.on('close', () => {
        this.logger.log('Deepgram STT connection closed');
        if (callbacks.onClose) {
          callbacks.onClose();
        }
      });

      socket.connect();
      if (typeof socket.waitForOpen === 'function') {
        await socket.waitForOpen();
      }

      this.logger.log('Deepgram Nova-2 live socket opened and ready');

      return {
        sendAudio: (chunk: Buffer | ArrayBuffer | Uint8Array) => {
          try {
            if (typeof socket.sendMedia === 'function') {
              socket.sendMedia(chunk);
            } else if (typeof socket.send === 'function') {
              socket.send(chunk);
            }
          } catch (err: unknown) {
            this.logger.warn(
              `Failed to send audio chunk to Deepgram: ${String(err)}`,
            );
          }
        },
        finish: async () => {
          try {
            if (typeof socket.close === 'function') {
              socket.close();
            }
          } catch (err: unknown) {
            this.logger.warn(
              `Error closing Deepgram live session: ${String(err)}`,
            );
          }
          await Promise.resolve();
        },
      };
    } catch (error: unknown) {
      this.logger.error('Failed to instantiate Deepgram live session', error);
      throw error;
    }
  }
}
