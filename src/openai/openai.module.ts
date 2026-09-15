import { Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { PentanaModule } from '../pentana/pentana.module';
import { CustomerDatabaseModule } from '../customer-database/customer-database.module';

@Module({
  imports: [PentanaModule, CustomerDatabaseModule],
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
