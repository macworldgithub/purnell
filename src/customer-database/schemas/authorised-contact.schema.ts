import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuthorisedContactDocument = AuthorisedContact & Document;

@Schema({ _id: false })
export class AuthorisedThirdParty {
  @Prop({ required: true })
  name: string;

  @Prop()
  relationship: string;

  @Prop()
  mobile: string;

  @Prop({ type: [String], default: [] })
  authorised_for: string[];
}

@Schema({ timestamps: true })
export class AuthorisedContact {
  @Prop({ required: true, unique: true, index: true })
  customer_id: string;

  @Prop({ type: [AuthorisedThirdParty], default: [] })
  authorised_third_parties: AuthorisedThirdParty[];
}

export const AuthorisedContactSchema =
  SchemaFactory.createForClass(AuthorisedContact);
