import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CustomerDocument = Customer & Document;

@Schema({ _id: false })
export class CustomerFlags {
  @Prop({ default: false })
  vip: boolean;

  @Prop({ default: false })
  warranty_open: boolean;

  @Prop({ default: false })
  complaint_open: boolean;

  @Prop({ default: false })
  awaiting_callback: boolean;
}

@Schema({ _id: false })
export class Vehicle {
  @Prop({ required: true, index: true })
  rego: string;

  @Prop({ type: String })
  vin: string;

  @Prop({ type: Number })
  year: number;

  @Prop({ type: String })
  make: string;

  @Prop({ type: String })
  model: string;

  @Prop({ type: String })
  colour: string;

  @Prop({ type: String, default: null })
  assigned_advisor: string | null;

  @Prop({ type: String, default: null })
  assigned_sales: string | null;

  @Prop({ type: String })
  franchise?: string;
}

@Schema({ _id: false })
export class LastService {
  @Prop({ type: String })
  date: string;

  @Prop({ type: Number })
  mileage: number;

  @Prop({ type: String })
  advisor: string;
}

@Schema({ timestamps: true })
export class Customer {
  @Prop({ required: true, unique: true, index: true })
  customer_id: string;

  @Prop({ required: true })
  customer_name: string;

  @Prop({ type: String })
  preferred_name: string;

  @Prop({ type: String })
  customer_since: string;

  @Prop({ required: true, index: true })
  mobile: string;

  @Prop({ type: String, default: null })
  landline: string | null;

  @Prop({ type: String })
  email: string;

  @Prop({ default: true })
  consent_sms: boolean;

  @Prop({ default: false })
  consent_marketing: boolean;

  @Prop({ type: CustomerFlags, default: {} })
  flags: CustomerFlags;

  @Prop({ type: [Vehicle], default: [] })
  vehicles: Vehicle[];

  @Prop({ type: LastService, default: null })
  last_service: LastService | null;

  @Prop({ type: String })
  scenario: string;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
