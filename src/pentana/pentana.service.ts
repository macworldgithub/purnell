import { Injectable, Logger } from '@nestjs/common';
import {
  MOCK_PENTANA_CUSTOMERS,
  MOCK_STAFF_MEMBERS,
  MOCK_APPOINTMENT_SLOTS,
  ROADSIDE_ASSISTANCE,
  SITE_ROUTING,
  PentanaCustomer,
  StaffMember,
  AppointmentSlot,
  HandoffRecord,
} from './pentana.data';

@Injectable()
export class PentanaService {
  private readonly logger = new Logger(PentanaService.name);

  normalizePhone(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
  }

  searchCustomer(query: string): PentanaCustomer | null {
    const clean = this.normalizePhone(query);
    const qUpper = query.trim().toUpperCase();

    return (
      MOCK_PENTANA_CUSTOMERS.find((c) => {
        const matchCli =
          clean.length >= 6 && this.normalizePhone(c.cli).includes(clean);
        const matchRego = c.rego.toUpperCase().includes(qUpper);
        const matchName = c.name.toUpperCase().includes(qUpper);
        return matchCli || matchRego || matchName;
      }) || null
    );
  }

  checkStaff(name: string): StaffMember | null {
    const n = name.trim().toLowerCase();
    return (
      MOCK_STAFF_MEMBERS.find((s) => s.name.toLowerCase().includes(n)) || null
    );
  }

  getAppointmentSlots(): AppointmentSlot[] {
    return MOCK_APPOINTMENT_SLOTS;
  }

  getRoadsideNumber(brand: string): string {
    for (const [key, num] of Object.entries(ROADSIDE_ASSISTANCE)) {
      if (brand.toLowerCase().includes(key.toLowerCase())) {
        return num;
      }
    }
    return ROADSIDE_ASSISTANCE['Land Rover'];
  }

  getSiteRouting(brand: string) {
    if (
      brand.toLowerCase().includes('jaecoo') ||
      brand.toLowerCase().includes('jq') ||
      brand.toLowerCase().includes('ineos') ||
      brand.toLowerCase().includes('grenadier')
    ) {
      return SITE_ROUTING.jaecoo;
    }
    return SITE_ROUTING.jlr;
  }

  formatHandoffRecord(record: Partial<HandoffRecord>): string {
    const now =
      record.timestamp ||
      new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
    return [
      'HANDOFF RECORD',
      '--------------',
      `Timestamp: ${now}`,
      `Intent label: ${record.intentLabel || 'General Enquiry'}`,
      `Caller name: ${record.callerName || 'Unknown Caller'}`,
      `Callback number: ${record.callbackNumber || 'N/A'}`,
      `Vehicle: ${record.vehicle || 'Not specified'}`,
      `Reason: ${record.reason || 'General inquiry'}`,
      `Urgency: ${record.urgency || 'Medium'}`,
      `Destination: ${record.destination || 'Service / Sales Team'}`,
      `Transfer attempted: ${record.transferAttempted || 'N/A'}`,
      `Transfer outcome: ${record.transferOutcome || 'Callback created'}`,
      `Source context: ${record.sourceContext || 'Pentana Voice Session'}`,
      `Promised callback window: ${record.promisedCallbackWindow || 'Within 10–30 minutes'}`,
    ].join('\n');
  }
}
