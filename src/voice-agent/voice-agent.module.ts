import { Module } from '@nestjs/common';
import { VoiceAgentService } from './voice-agent.service';
import { VoiceAgentController } from './voice-agent.controller';
import { VoiceAgentGateway } from './voice-agent.gateway';
import { DeepgramModule } from '../deepgram/deepgram.module';
import { ElevenLabsModule } from '../elevenlabs/elevenlabs.module';
import { OpenAiModule } from '../openai/openai.module';
import { PentanaModule } from '../pentana/pentana.module';

@Module({
  imports: [DeepgramModule, ElevenLabsModule, OpenAiModule, PentanaModule],
  controllers: [VoiceAgentController],
  providers: [VoiceAgentService, VoiceAgentGateway],
  exports: [VoiceAgentService],
})
export class VoiceAgentModule {}
