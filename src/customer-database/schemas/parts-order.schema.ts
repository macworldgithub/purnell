import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartsOrderDocument = PartsOrder & Document;

@Schema({ _id: false })
export class PartsOrderLine {
  @Prop({ type: String })
  part_number: string;

  @Prop({ type: String })
  description: string;

  @Prop({ type: String })
  status: string;

  @Prop({ default: false })
  arrived: boolean;

  @Prop({ type: String, default: null })
  arrival_date: string | null;

  @Prop({ default: false })
  fitment_booked: boolean;
}

@Schema({ timestamps: true })
export class PartsOrder {
  @Prop({ required: true, unique: true, index: true })
  parts_order_id: string;

  @Prop({ type: String, index: true })
  ro_number: string;

  @Prop({ required: true, index: true })
  customer_id: string;

  @Prop({ type: String, index: true })
  vehicle_rego: string;

  @Prop({ type: [PartsOrderLine], default: [] })
  lines: PartsOrderLine[];

  @Prop({ type: String })
  notify_on: string;

  @Prop({ default: false })
  sms_sent: boolean;

  @Prop({ type: String, default: null })
  suppress_until: string | null;
}

export const PartsOrderSchema = SchemaFactory.createForClass(PartsOrder);
