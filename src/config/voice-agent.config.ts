import * as dotenv from 'dotenv';
dotenv.config();

export interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  model: string;
  outputFormat: string;
  voiceSettings: ElevenLabsVoiceSettings;
  latencyOptimization: number;
}

export interface OpenAiVadConfig {
  type: 'server_vad';
  threshold: number;
  prefix_padding_ms: number;
  silence_duration_ms: number;
  barge_in_grace_ms: number;
}

export interface OpenAiBrainConfig {
  apiKey: string;
  model: string;
  temperature: number;
  vad: OpenAiVadConfig;
}

export interface DeepgramSttConfig {
  apiKey: string;
  model: string;
  language: string;
  smart_format: boolean;
  encoding: string;
  sample_rate: number;
  channels: number;
  endpointing: number;
  interim_results: boolean;
}

export interface VoiceAgentConfig {
  elevenlabs: ElevenLabsConfig;
  openai: OpenAiBrainConfig;
  deepgram: DeepgramSttConfig;
}

export const VOICE_AGENT_CONFIG: VoiceAgentConfig = {
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'WLKp2jV6nrS8aMkPPDRO',
    // eleven_flash_v2_5: Low latency model optimized for real-time conversation
    model: 'eleven_flash_v2_5',
    outputFormat: 'pcm_16000',
    voiceSettings: {
      // 0.5: Natural, less robotic
      stability: 0.5,
      similarity_boost: 0.75,
      // 0.2: Professional luxury automotive receptionist composure (non-theatrical)
      style: 0.2,
      use_speaker_boost: true,
    },
    latencyOptimization: 3,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-mini',
    temperature: 0.6,
    vad: {
      type: 'server_vad',
      // 0.75: Tuned to ignore low-level background noise and speaker echo
      threshold: 0.75,
      // 300ms: Captures starts of sentences accurately
      prefix_padding_ms: 300,
      // 1200ms: Natural conversational turn cadence without premature cutoffs
      silence_duration_ms: 1200,
      // 800ms: Stable barge-in grace period
      barge_in_grace_ms: 800,
    },
  },
  deepgram: {
    apiKey:
      process.env.DEEPGRAM_API_KEY ||
      process.env.DeepGram_API_Key ||
      '',
    model: 'nova-3',
    language: 'en',
    smart_format: true,
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    endpointing: 300,
    interim_results: true,
  },
};
