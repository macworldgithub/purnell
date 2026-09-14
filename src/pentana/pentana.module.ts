import { Module } from '@nestjs/common';
import { PentanaService } from './pentana.service';

@Module({
  providers: [PentanaService],
  exports: [PentanaService],
})
export class PentanaModule {}
