import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { mongo } from 'mongoose';
import { capacityAnswer } from './appointment-capacity';

@Injectable()
export class AppointmentAvailabilityService implements OnModuleDestroy {
  private client?: mongo.MongoClient;
  private readonly logger = new Logger(AppointmentAvailabilityService.name);

  async getAvailability(preference?: string) {
    try {
      if (!this.client) {
        let local: Record<string, string> = {};
        try { local = parse(readFileSync(join(process.cwd(), '.env.erapower-sync'))); } catch { /* Hosted environments use environment variables. */ }
        const uri = process.env.ERAPOWER_DATA_MONGO_URI || process.env.PURNELL_COPY_TARGET_URI || local.PURNELL_COPY_TARGET_URI;
        if (!uri) return capacityAnswer([]);
        this.client = new mongo.MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 });
      }
      await this.client.connect();
      const collection = this.client.db('Purnell_Pentana_VoiceAgent').collection('erapower_current_daily_booking_capacity');
      const scope = { 'data.dealership_id': '01', 'data.department_id': 'S', 'data.advisor_scope': 'all' };
      const latest = await collection.findOne(scope, { sort: { observed_at: -1 }, maxTimeMS: 5000 });
      if (!latest?.run_id) return capacityAnswer([]);
      const docs = await collection.find({ ...scope, run_id: latest.run_id }, { projection: { data: 1, observed_at: 1 }, maxTimeMS: 5000 }).toArray();
      return capacityAnswer(docs, preference);
    } catch {
      this.logger.warn('Verified appointment capacity could not be read; no dates offered.');
      return capacityAnswer([]);
    }
  }

  async onModuleDestroy() { await this.client?.close(); }
}
