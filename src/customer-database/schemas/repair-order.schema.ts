import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RepairOrderDocument = RepairOrder & Document;

@Schema({ _id: false })
export class LoanVehicle {
  @Prop({ default: false })
  active: boolean;

  @Prop({ type: String, default: null })
  rego: string | null;

  @Prop({ type: String, default: null })
  make: string | null;

  @Prop({ type: String, default: null })
  model: string | null;

  @Prop({ type: String })
  due_back?: string;

  @Prop({ type: Boolean })
  extension_possible?: boolean;
}

@Schema({ _id: false })
export class JobLine {
  @Prop({ type: Number })
  line_id: number;

  @Prop({ type: String })
  description: string;

  @Prop({ type: String })
  status: string;
}

@Schema({ timestamps: true })
export class RepairOrder {
  @Prop({ required: true, unique: true, index: true })
  ro_number: string;

  @Prop({ required: true, index: true })
  customer_id: string;

  @Prop({ required: true, index: true })
  vehicle_rego: string;

  @Prop({ required: true })
  status: string;

  @Prop({ type: String })
  drop_off_date: string;

  @Prop({ type: String, default: null })
  drop_off_time: string | null;

  @Prop({ type: String, default: null })
  eta: string | null;

  @Prop({ type: String })
  advisor: string;

  @Prop({ default: false })
  awaiting_approval: boolean;

  @Prop({ default: false })
  awaiting_parts: boolean;

  @Prop({ default: false })
  ready_for_collection: boolean;

  @Prop({ type: LoanVehicle, default: {} })
  loan_vehicle: LoanVehicle;

  @Prop({ type: [JobLine], default: [] })
  job_lines: JobLine[];

  @Prop({ type: String })
  workshop_notes: string;
}

export const RepairOrderSchema = SchemaFactory.createForClass(RepairOrder);
