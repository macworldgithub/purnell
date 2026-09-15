import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VoiceAgentModule } from './voice-agent/voice-agent.module';
import { CustomerDatabaseModule } from './customer-database/customer-database.module';

@Module({
  imports: [CustomerDatabaseModule, VoiceAgentModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
