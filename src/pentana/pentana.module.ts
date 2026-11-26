import { Module } from '@nestjs/common';
import { PentanaService } from './pentana.service';
import { AppointmentAvailabilityService } from './appointment-availability.service';

@Module({
  providers: [PentanaService, AppointmentAvailabilityService],
  exports: [PentanaService],
})
export class PentanaModule {}
