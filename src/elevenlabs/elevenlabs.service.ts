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
    const startTime = Date.now();
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
      const buffer = Buffer.from(arrayBuffer);
      const durationMs = Date.now() - startTime;
      this.logger.log(
        `[ElevenLabs TTS] Buffer generated in ${durationMs}ms (${text.length} chars, ${(buffer.length / 1024).toFixed(1)} KB PCM audio)`,
      );
      return buffer;
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        abortSignal?.aborted
      ) {
        this.logger.log(
          `ElevenLabs buffer generation aborted due to interruption after ${durationMs}ms`,
        );
        return Buffer.alloc(0);
      }
      this.logger.error(`ElevenLabs speech synthesis failed after ${durationMs}ms: ${String(error)}`);
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
    onFirstChunk?: (ttfcMs: number) => void,
  ): Promise<{ ttfbMs: number; ttfcMs: number; totalDurationMs: number; totalBytes: number }> {
    const startTime = Date.now();
    let ttfbMs = 0;
    let ttfcMs = 0;
    let totalBytes = 0;
    let firstChunkReported = false;

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

      ttfbMs = Date.now() - startTime;

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(
          `ElevenLabs stream API error ${response.status}: ${errorText}`,
        );
      }

      const reader = response.body.getReader();
      let leftover = Buffer.alloc(0);

      while (true) {
        if (abortSignal?.aborted) {
          this.logger.log(
            `ElevenLabs stream aborted immediately due to caller interruption after ${Date.now() - startTime}ms`,
          );
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          // Flush any remaining even-aligned PCM data before closing
          if (leftover.length > 0 && !abortSignal?.aborted) {
            const evenLength = leftover.length - (leftover.length % 2);
            if (evenLength > 0) {
              const chunk = leftover.subarray(0, evenLength);
              totalBytes += chunk.length;
              onChunk(chunk);
            }
          }
          break;
        }

        if (value && !abortSignal?.aborted) {
          if (!firstChunkReported) {
            ttfcMs = Date.now() - startTime;
            firstChunkReported = true;
            if (onFirstChunk) {
              onFirstChunk(ttfcMs);
            }
          }

          const combined = leftover.length > 0
            ? Buffer.concat([leftover, Buffer.from(value)])
            : Buffer.from(value);
          const evenLength = combined.length - (combined.length % 2);
          if (evenLength > 0) {
            const chunk = combined.subarray(0, evenLength);
            totalBytes += chunk.length;
            onChunk(chunk);
            leftover = combined.subarray(evenLength);
          } else {
            leftover = combined;
          }
        }
      }

      const totalDurationMs = Date.now() - startTime;
      this.logger.log(
        `[ElevenLabs TTS] Stream completed | TTFB: ${ttfbMs}ms | First Chunk (TTFC): ${ttfcMs || totalDurationMs}ms | Total Stream: ${totalDurationMs}ms (${text.length} chars, ${(totalBytes / 1024).toFixed(1)} KB)`,
      );

      return {
        ttfbMs,
        ttfcMs: ttfcMs || totalDurationMs,
        totalDurationMs,
        totalBytes,
      };
    } catch (error: unknown) {
      const totalDurationMs = Date.now() - startTime;
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        abortSignal?.aborted
      ) {
        this.logger.log(
          `ElevenLabs streaming aborted due to barge-in interrupt after ${totalDurationMs}ms`,
        );
        return {
          ttfbMs,
          ttfcMs: ttfcMs || totalDurationMs,
          totalDurationMs,
          totalBytes,
        };
      }
      this.logger.error(`ElevenLabs streaming error after ${totalDurationMs}ms: ${String(error)}`);
      throw error;
    }
  }
}
