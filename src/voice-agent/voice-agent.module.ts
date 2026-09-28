import { Module } from '@nestjs/common';
import { VoiceAgentService } from './voice-agent.service';
import { VoiceAgentController } from './voice-agent.controller';
import { OpenAiModule } from '../openai/openai.module';
import { CustomerDatabaseModule } from '../customer-database/customer-database.module';

@Module({
  imports: [OpenAiModule, CustomerDatabaseModule],
  controllers: [VoiceAgentController],
  providers: [VoiceAgentService],
  exports: [VoiceAgentService],
})
export class VoiceAgentModule {}
