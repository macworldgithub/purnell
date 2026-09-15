import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

import { Customer, CustomerSchema } from './schemas/customer.schema';
import {
  RepairOrder,
  RepairOrderSchema,
} from './schemas/repair-order.schema';
import { PartsOrder, PartsOrderSchema } from './schemas/parts-order.schema';
import {
  ServiceBooking,
  ServiceBookingSchema,
} from './schemas/service-booking.schema';
import {
  AuthorisedContact,
  AuthorisedContactSchema,
} from './schemas/authorised-contact.schema';
import { CustomerDatabaseService } from './customer-database.service';

const mongoUri =
  process.env.MONGO_URI ||
  'mongodb+srv://salman:4lanHyMRdCrtXDJ7@sign365.nglnioh.mongodb.net/Purnell_Pentana_VoiceAgent?retryWrites=true&w=majority';

@Module({
  imports: [
    MongooseModule.forRoot(mongoUri),
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: RepairOrder.name, schema: RepairOrderSchema },
      { name: PartsOrder.name, schema: PartsOrderSchema },
      { name: ServiceBooking.name, schema: ServiceBookingSchema },
      { name: AuthorisedContact.name, schema: AuthorisedContactSchema },
    ]),
  ],
  providers: [CustomerDatabaseService],
  exports: [CustomerDatabaseService, MongooseModule],
})
export class CustomerDatabaseModule {}
