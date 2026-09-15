import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ServiceBookingDocument = ServiceBooking & Document;

@Schema({ timestamps: true })
export class ServiceBooking {
  @Prop({ required: true, unique: true, index: true })
  booking_id: string;

  @Prop({ required: true, index: true })
  customer_id: string;

  @Prop({ type: String, default: null, index: true })
  vehicle_rego: string | null;

  @Prop({ type: String })
  date: string;

  @Prop({ type: String })
  time: string;

  @Prop({ type: String })
  advisor: string;

  @Prop({ type: String })
  job_type: string;

  @Prop({ default: false })
  loan_car_requested: boolean;

  @Prop({ default: false })
  loan_car_confirmed: boolean;

  @Prop({ default: false })
  collect_and_return: boolean;

  @Prop({ type: String })
  status: string;

  @Prop({ type: String })
  notes?: string;
}

export const ServiceBookingSchema =
  SchemaFactory.createForClass(ServiceBooking);
