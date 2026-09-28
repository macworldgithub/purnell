import * as dotenv from 'dotenv';
dotenv.config();

export interface OpenAiBrainConfig {
  apiKey: string;
  model: string;
  temperature: number;
}

export const VOICE_AGENT_CONFIG: { openai: OpenAiBrainConfig } = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_REASONING_MODEL || 'gpt-4o-mini',
    temperature: 0.6,
  },
};
