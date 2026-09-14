import { Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { PentanaModule } from '../pentana/pentana.module';

@Module({
  imports: [PentanaModule],
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
