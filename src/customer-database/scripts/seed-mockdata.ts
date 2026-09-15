import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';

dotenv.config();

import { CustomerSchema } from '../schemas/customer.schema';
import { RepairOrderSchema } from '../schemas/repair-order.schema';
import { PartsOrderSchema } from '../schemas/parts-order.schema';
import { ServiceBookingSchema } from '../schemas/service-booking.schema';
import { AuthorisedContactSchema } from '../schemas/authorised-contact.schema';

const mongoUri =
  process.env.MONGO_URI ||
  'mongodb+srv://salman:4lanHyMRdCrtXDJ7@sign365.nglnioh.mongodb.net/Purnell_Pentana_VoiceAgent?retryWrites=true&w=majority';

async function seed() {
  console.log('Connecting to MongoDB at:', mongoUri);
  await mongoose.connect(mongoUri);

  const CustomerModel = mongoose.model('Customer', CustomerSchema);
  const RepairOrderModel = mongoose.model('RepairOrder', RepairOrderSchema);
  const PartsOrderModel = mongoose.model('PartsOrder', PartsOrderSchema);
  const ServiceBookingModel = mongoose.model(
    'ServiceBooking',
    ServiceBookingSchema,
  );
  const AuthorisedContactModel = mongoose.model(
    'AuthorisedContact',
    AuthorisedContactSchema,
  );

  const mockDataPath = path.join(process.cwd(), 'mockdata.json');
  if (!fs.existsSync(mockDataPath)) {
    console.error('mockdata.json not found at:', mockDataPath);
    process.exit(1);
  }

  const rawData = fs.readFileSync(mockDataPath, 'utf8');
  const data = JSON.parse(rawData);

  console.log('Seeding Customers...');
  if (data.customers && Array.isArray(data.customers)) {
    for (const item of data.customers) {
      await CustomerModel.updateOne(
        { customer_id: item.customer_id },
        { $set: item },
        { upsert: true },
      );
    }
    console.log(`✓ Upserted ${data.customers.length} Customers`);
  }

  console.log('Seeding Repair Orders...');
  if (data.repair_orders && Array.isArray(data.repair_orders)) {
    for (const item of data.repair_orders) {
      await RepairOrderModel.updateOne(
        { ro_number: item.ro_number },
        { $set: item },
        { upsert: true },
      );
    }
    console.log(`✓ Upserted ${data.repair_orders.length} Repair Orders`);
  }

  console.log('Seeding Parts Orders...');
  if (data.parts_orders && Array.isArray(data.parts_orders)) {
    for (const item of data.parts_orders) {
      await PartsOrderModel.updateOne(
        { parts_order_id: item.parts_order_id },
        { $set: item },
        { upsert: true },
      );
    }
    console.log(`✓ Upserted ${data.parts_orders.length} Parts Orders`);
  }

  console.log('Seeding Service Bookings...');
  if (data.service_bookings && Array.isArray(data.service_bookings)) {
    for (const item of data.service_bookings) {
      await ServiceBookingModel.updateOne(
        { booking_id: item.booking_id },
        { $set: item },
        { upsert: true },
      );
    }
    console.log(`✓ Upserted ${data.service_bookings.length} Service Bookings`);
  }

  console.log('Seeding Authorised Contacts...');
  if (data.authorised_contacts && Array.isArray(data.authorised_contacts)) {
    for (const item of data.authorised_contacts) {
      await AuthorisedContactModel.updateOne(
        { customer_id: item.customer_id },
        { $set: item },
        { upsert: true },
      );
    }
    console.log(
      `✓ Upserted ${data.authorised_contacts.length} Authorised Contacts`,
    );
  }

  console.log('✓ Seeding complete!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});
