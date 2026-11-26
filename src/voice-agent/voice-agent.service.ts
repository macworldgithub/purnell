import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { CustomerDatabaseService, FullCustomerProfile } from '../customer-database/customer-database.service';
import { normalizeAustralianPhone } from '../common/utils/phone-normalizer';
import { OpenAiService } from '../openai/openai.service';

const digitsToWords = (value: string): string => value.split('').join(' ');

function formatPhoneForSpeech(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length >= 10) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('04')) {
    return `${digitsToWords(digits.slice(0, 4))}, ${digitsToWords(digits.slice(4, 7))}, ${digitsToWords(digits.slice(7))}`;
  }
  if (digits.length === 10) {
    return `${digitsToWords(digits.slice(0, 2))}, ${digitsToWords(digits.slice(2, 6))}, ${digitsToWords(digits.slice(6))}`;
  }
  return digits.length >= 6 ? digitsToWords(digits) : phone || 'your number';
}

export interface ConversationTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LiveDelegationTimings {
  dbLookupMs: number;
  llmTotalMs: number;
  llmIterations?: number;
  llmCallsMs?: number[];
  toolCalls?: { name: string; durationMs: number }[];
  totalMs: number;
}

@Injectable()
export class VoiceAgentService {
  private readonly calls = new Map<string, { cli: string; customerId?: string; expires: number }>();

  createCall(cli: string): string {
    for (const [key, value] of this.calls) if (value.expires < Date.now()) this.calls.delete(key);
    const id = randomUUID();
    this.calls.set(id, { cli: normalizeAustralianPhone(cli), expires: Date.now() + 60 * 60 * 1000 });
    return id;
  }
  private readonly logger = new Logger(VoiceAgentService.name);

  constructor(
    private readonly openAiService: OpenAiService,
    private readonly customerDatabaseService: CustomerDatabaseService,
  ) {}

  async getLiveCallerContext(cli: string): Promise<{ greeting: string; callerKnown: boolean }> {
    const normalizedCli = normalizeAustralianPhone(cli || '');
    const profile = normalizedCli
      ? await this.customerDatabaseService.getFullCustomerProfile(normalizedCli)
      : null;

    if (profile?.customer) {
      const name = profile.customer.preferred_name || profile.customer.customer_name;
      return {
        callerKnown: true,
        greeting: `Hello ${name}, Purnell Motors, Blakehurst. How can I help you with your vehicle today?`,
      };
    }

    return {
      callerKnown: false,
      greeting: 'Hello, you have reached Purnell Motors in Blakehurst. Our voice service is available to registered customers. May I have your full name and vehicle registration so I can verify your account?',
    };
  }

  private formatCustomerContext(profile: FullCustomerProfile | null, cli: string): string {
    const spokenCli = formatPhoneForSpeech(cli);
    if (!profile?.customer) {
      return [
        'CALLER IDENTIFICATION STATUS: Unidentified / Ambiguous',
        `INCOMING PHONE (CLI): ${cli || 'Unknown'} (Spoken: "${spokenCli}")`,
        'OPERATIONAL INSTRUCTIONS FOR UNIDENTIFIED CALLER:',
        '1. This agent provides service only to registered customers. Until verification succeeds, do not provide dealership service, collect a service request, or access or disclose any customer record.',
        '2. Ask for the caller full name and vehicle registration. Do not disclose, confirm, deny, or repeat any customer name, registration, vehicle, booking, repair order, or other personal data while unverified.',
        '3. Once both details are supplied, use verifyPentanaCustomer so they must resolve to the same CRM record. Do not use lookupPentanaCustomer to verify an unknown or third-party caller.',
        '4. Only use returned customer data if verification is true. If verification fails, say Purnell services registered customers only and offer a message for the team to help with registration. Never reveal which detail matched or any other record data.',
        '5. Always speak phone numbers digit by digit with spaces and commas, and spell vehicle registration plates letter by letter. Never pronounce phone numbers as thousands or compound words.',
      ].join('\n');
    }

    const customer = profile.customer;
    const vehicles = (customer.vehicles || []).map((vehicle) =>
      `- ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} (Rego: ${vehicle.rego || 'N/A'}, VIN: ${vehicle.vin || 'N/A'}, Colour: ${vehicle.colour || 'N/A'})`,
    ).join('\n  ');
    const repairOrders = (profile.repair_orders || []).map((order) => {
      const imported = order as typeof order & {
        pentana_snapshot?: string;
        promised_date?: string;
        promised_time?: string;
        source_narratives?: Array<{ complaint?: string; cause?: string; correction?: string }>;
      };
      if (imported.pentana_snapshot || imported.source_narratives?.length) {
        return JSON.stringify({
          repairOrder: order.ro_number, registration: order.vehicle_rego, advisor: order.advisor,
          snapshotDate: imported.pentana_snapshot, recordedStatus: order.status,
          recordedDropOff: order.drop_off_date, historicalPromisedDate: imported.promised_date,
          historicalPromisedTime: imported.promised_time, notes: imported.source_narratives,
        });
      }
      return `- RO #${order.ro_number}: Rego ${order.vehicle_rego} | Status: "${order.status}" | Advisor: ${order.advisor} | Drop-off: ${order.drop_off_date} | Ready for Collection: ${order.ready_for_collection ? 'YES' : 'NO'} | Awaiting Approval: ${order.awaiting_approval ? 'YES' : 'NO'}`;
    }).join('\n  ');
    const bookings = (profile.service_bookings || []).map((booking) =>
      `- ${booking.date} at ${booking.time} (${booking.job_type}), Advisor ${booking.advisor}, Rego ${booking.vehicle_rego || 'On file'}`,
    ).join('\n  ');
    const parts = (profile.parts_orders || []).map((order) => {
      const lines = order.lines?.map((line) =>
        `${line.description || 'Part'} (Status: ${line.status}, Arrived: ${line.arrived ? 'YES' : 'NO'})`,
      ).join(', ');
      return `- Order #${order.parts_order_id} (RO: ${order.ro_number || 'N/A'}, Rego: ${order.vehicle_rego}): ${lines || 'Parts on order'}`;
    }).join('\n  ');
    const contacts = (profile.authorised_contacts?.authorised_third_parties || []).map((contact) =>
      `- ${contact.name} (${contact.relationship}): ${contact.mobile} [Authorised for: ${(contact.authorised_for || []).join(', ') || 'General'}]`,
    ).join('\n  ') || 'None listed';
    const primaryVehicle = customer.vehicles?.[0];

    return [
      'CALLER IDENTIFICATION STATUS: VERIFIED / HIGH CONFIDENCE',
      `CUSTOMER ID: ${customer.customer_id}`,
      `CUSTOMER NAME: ${customer.customer_name} (Preferred: ${customer.preferred_name || customer.customer_name})`,
      `MOBILE: ${customer.mobile || 'N/A'} | LANDLINE: ${customer.landline || 'N/A'}`,
      `ASSIGNED SERVICE ADVISOR: ${primaryVehicle?.assigned_advisor || 'Service Team'}`,
      `ASSIGNED SALES CONSULTANT: ${primaryVehicle?.assigned_sales || 'Sales Team'}`,
      `REGISTERED VEHICLES:\n  ${vehicles || 'None listed'}`,
      `OPEN REPAIR ORDERS:\n  ${repairOrders || 'No open repair orders'}`,
      `UPCOMING SERVICE BOOKINGS:\n  ${bookings || 'No upcoming bookings'}`,
      `PARTS ORDERS:\n  ${parts || 'No parts orders on file'}`,
      `AUTHORISED CONTACTS:\n  ${contacts}`,
      'OPERATIONAL INSTRUCTIONS:',
      '1. This client is verified in CRM context. Use this information to answer questions directly; retain this context across turns.',
      '2. Answer inquiries about vehicle status, service bookings, parts, and advisors from the available customer data.',
      '3. Always speak phone numbers digit by digit with spaces and commas, and spell vehicle registration plates letter by letter. Never pronounce phone numbers as thousands or compound words.',
      '4. Be natural, concise, and professional. Confirm names and clarify requests without reciting the whole database at once.',
    ].join('\n');
  }

  async processTextMessage(
    userText: string,
    history: ConversationTurn[] = [],
    cli = '',
    callToken?: string,
  ): Promise<{
    text: string;
    toolLogs?: string[];
    timings: LiveDelegationTimings;
  }> {
    const startedAt = Date.now();
    const call = callToken ? this.calls.get(callToken) : undefined;
    if (callToken && (!call || call.expires < Date.now())) throw new Error('Call session expired. Start a new call.');
    const normalizedCli = call?.cli ?? normalizeAustralianPhone(cli);
    const lookupStartedAt = Date.now();
    const profile = call?.customerId || normalizedCli
      ? await this.customerDatabaseService.getFullCustomerProfile(call?.customerId || normalizedCli)
      : null;
    const dbLookupMs = Date.now() - lookupStartedAt;
    const customerContext = this.formatCustomerContext(profile, normalizedCli);
    const messages = [...history];
    const lastMessage = messages.at(-1);
    if (lastMessage?.role !== 'user' || lastMessage.content !== userText) {
      messages.push({ role: 'user', content: userText });
    }
    const llmStartedAt = Date.now();
    if (profile && call) call.customerId = profile.customer.customer_id;
    let newlyVerified: string | undefined;
    const result = await this.openAiService.generateResponse(
      messages.map(({ role, content }) => ({ role, content })),
      customerContext,
      profile?.customer.customer_id,
      id => { newlyVerified = id; if (call) call.customerId = id; },
      callToken ? { callId: callToken, turnId: randomUUID(), callerText: userText } : undefined,
    );
    if (newlyVerified && !profile) {
      result.text = 'Thanks, I’ve verified your account. How can I help?';
    } else if (!profile) {
      result.text = 'Please provide the customer full name and vehicle registration so I can verify the account before sharing any records.';
    }
    const timings = {
      dbLookupMs,
      llmTotalMs: Date.now() - llmStartedAt,
      llmIterations: result.timings?.iterations,
      llmCallsMs: result.timings?.llmCallsMs,
      toolCalls: result.timings?.toolCalls,
      totalMs: Date.now() - startedAt,
    };

    this.logger.log(
      `Live delegation processed in ${timings.totalMs}ms (tools: ${timings.toolCalls?.length || 0}).`,
    );
    return { text: result.text, toolLogs: result.toolLogs, timings };
  }
}
