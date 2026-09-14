import { Injectable, Logger } from '@nestjs/common';
import {
  VOICE_AGENT_CONFIG,
  ElevenLabsConfig,
} from '../config/voice-agent.config';

@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger(ElevenLabsService.name);
  private readonly config: ElevenLabsConfig = VOICE_AGENT_CONFIG.elevenlabs;

  constructor() {
    this.logger.log(
      `ElevenLabs TTS Service initialized (Model: ${this.config.model}, Format: ${this.config.outputFormat})`,
    );
  }

  /**
   * Returns current ElevenLabs configuration for voice synthesis
   */
  getConfig(): ElevenLabsConfig {
    return this.config;
  }

  /**
   * Generates low-latency PCM 16kHz audio buffer for a given text
   */
  async generateSpeechBuffer(
    text: string,
    abortSignal?: AbortSignal,
  ): Promise<Buffer> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}?output_format=${this.config.outputFormat}&optimize_streaming_latency=${this.config.latencyOptimization}`;

    const headers = {
      'Content-Type': 'application/json',
      'xi-api-key': this.config.apiKey,
      Accept: 'audio/pcm',
    };

    const payload = {
      text,
      model_id: this.config.model,
      voice_settings: {
        stability: this.config.voiceSettings.stability,
        similarity_boost: this.config.voiceSettings.similarity_boost,
        style: this.config.voiceSettings.style,
        use_speaker_boost: this.config.voiceSettings.use_speaker_boost,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `ElevenLabs API returned ${response.status}: ${errorText}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error: unknown) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        abortSignal?.aborted
      ) {
        this.logger.log(
          'ElevenLabs buffer generation aborted due to interruption',
        );
        return Buffer.alloc(0);
      }
      this.logger.error(`ElevenLabs speech synthesis failed: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Generates low-latency PCM 16kHz audio stream chunk-by-chunk with immediate abort support
   */
  async streamSpeech(
    text: string,
    onChunk: (chunk: Buffer) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream?output_format=${this.config.outputFormat}&optimize_streaming_latency=${this.config.latencyOptimization}`;

    const headers = {
      'Content-Type': 'application/json',
      'xi-api-key': this.config.apiKey,
      Accept: 'audio/pcm',
    };

    const payload = {
      text,
      model_id: this.config.model,
      voice_settings: {
        stability: this.config.voiceSettings.stability,
        similarity_boost: this.config.voiceSettings.similarity_boost,
        style: this.config.voiceSettings.style,
        use_speaker_boost: this.config.voiceSettings.use_speaker_boost,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(
          `ElevenLabs stream API error ${response.status}: ${errorText}`,
        );
      }

      const reader = response.body.getReader();
      while (true) {
        if (abortSignal?.aborted) {
          this.logger.log(
            'ElevenLabs stream aborted immediately due to caller interruption',
          );
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;
        if (value && !abortSignal?.aborted) {
          onChunk(Buffer.from(value));
        }
      }
    } catch (error: unknown) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        abortSignal?.aborted
      ) {
        this.logger.log(
          'ElevenLabs streaming aborted due to barge-in interrupt',
        );
        return;
      }
      this.logger.error(`ElevenLabs streaming error: ${String(error)}`);
      throw error;
    }
  }
}
