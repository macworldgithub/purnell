import { Module } from '@nestjs/common';
import { PentanaService } from './pentana.service';
import { AppointmentAvailabilityService } from './appointment-availability.service';
import { AppointmentRequestService } from './appointment-request.service';

@Module({
  providers: [PentanaService, AppointmentAvailabilityService, AppointmentRequestService],
  exports: [PentanaService],
})
export class PentanaModule {}
