import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VoiceAgentModule } from './voice-agent/voice-agent.module';

@Module({
  imports: [VoiceAgentModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
