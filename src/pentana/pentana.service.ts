import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppointmentAvailabilityService } from './appointment-availability.service';
import { capacityAnswer } from './appointment-capacity';
import { AppointmentRequestService } from './appointment-request.service';
import type { AppointmentCallContext } from './appointment-request.service';
import {
  MOCK_PENTANA_CUSTOMERS,
  MOCK_STAFF_MEMBERS,
  ROADSIDE_ASSISTANCE,
  SITE_ROUTING,
  PentanaCustomer,
  StaffMember,
  HandoffRecord,
} from './pentana.data';

@Injectable()
export class PentanaService {
  private readonly logger = new Logger(PentanaService.name);
  constructor(@Optional() private readonly appointmentAvailability?: AppointmentAvailabilityService, @Optional() private readonly appointmentRequests?: AppointmentRequestService) {}

  getPendingAppointmentRequest(context: AppointmentCallContext, customerId: string) {
    return this.appointmentRequests?.getPending(context, customerId) || null;
  }

  beginAppointmentRequestTurn(context: AppointmentCallContext, customerId: string) {
    this.appointmentRequests?.beginTurn(context, customerId);
  }

  async prepareAppointmentRequest(args: Record<string, unknown>, customer: { customer_id: string; customer_name: string; vehicles?: { rego: string }[] }, context?: AppointmentCallContext) {
    return this.appointmentRequests ? this.appointmentRequests.prepare(args, customer, context) : { status: 'unavailable', response: 'Appointment request saving is unavailable. Please contact Service.' };
  }

  async confirmAppointmentRequest(draftId: unknown, customerId: string, context?: AppointmentCallContext) {
    return this.appointmentRequests ? this.appointmentRequests.confirm(draftId, customerId, context) : { status: 'unavailable', response: 'Appointment request saving is unavailable. Please contact Service.' };
  }

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

  async getAppointmentSlots(preferredDay?: string) {
    return this.appointmentAvailability ? this.appointmentAvailability.getAvailability(preferredDay) : capacityAnswer([]);
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
