import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import {
  VOICE_AGENT_CONFIG,
  OpenAiBrainConfig,
} from '../config/voice-agent.config';
import { PentanaService } from '../pentana/pentana.service';
import { AppointmentSlot } from '../pentana/pentana.data';

import { CustomerDatabaseService } from '../customer-database/customer-database.service';

interface LookupCustomerArgs {
  query?: string;
}

interface VerifyCustomerArgs {
  customerName?: string;
  registration?: string;
}

interface StaffAvailabilityArgs {
  staffName?: string;
}

interface ParsedToolResult {
  simulatedLog?: string;
  found?: boolean;
  success?: boolean;
}

export interface ToolCallTiming {
  name: string;
  durationMs: number;
}

export interface OpenAiResponseTimings {
  totalMs: number;
  iterations: number;
  llmCallsMs: number[];
  toolCalls: ToolCallTiming[];
}

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly config: OpenAiBrainConfig = VOICE_AGENT_CONFIG.openai;
  private readonly openai: OpenAI;
  private cachedSystemPrompt: string = '';

  constructor(
    private readonly pentanaService: PentanaService,
    private readonly customerDatabaseService: CustomerDatabaseService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.apiKey });
    this.loadSystemPromptAndKB();
    this.logger.log(
      `OpenAI Brain Service initialized (Model: ${this.config.model})`,
    );
  }

  /**
   * Reads System Prompt.md and KB.md from project root and combines them into OpenAI system instructions
   */
  public loadSystemPromptAndKB(): string {
    try {
      const rootDir = process.cwd();
      const systemPromptPath = path.join(rootDir, 'System Prompt.md');
      const kbPath = path.join(rootDir, 'KB.md');

      let systemPromptText = '';
      let kbText = '';

      if (fs.existsSync(systemPromptPath)) {
        systemPromptText = fs.readFileSync(systemPromptPath, 'utf8');
      } else {
        this.logger.warn(`System Prompt file not found at ${systemPromptPath}`);
      }

      if (fs.existsSync(kbPath)) {
        kbText = fs.readFileSync(kbPath, 'utf8');
      } else {
        this.logger.warn(`Knowledge Base file not found at ${kbPath}`);
      }

      this.cachedSystemPrompt = `
===============================================================================
SYSTEM PROMPT INSTRUCTIONS
===============================================================================
${systemPromptText.trim()}

===============================================================================
KNOWLEDGE BASE (KB) INSTRUCTIONS
===============================================================================
${kbText.trim()}
      `.trim();

      this.logger.log(
        `System Prompt and KB loaded successfully (${this.cachedSystemPrompt.length} chars)`,
      );
      return this.cachedSystemPrompt;
    } catch (error: unknown) {
      this.logger.error('Error loading System Prompt / KB files:', error);
      this.cachedSystemPrompt =
        'You are the AI Receptionist for Purnell Motors Pty Ltd.';
      return this.cachedSystemPrompt;
    }
  }

  /**
   * Returns current System Prompt + Knowledge Base
   */
  getSystemPrompt(): string {
    if (!this.cachedSystemPrompt) {
      return this.loadSystemPromptAndKB();
    }
    return this.cachedSystemPrompt;
  }

  /** Creates a browser WebRTC session using GPT-Live-1. */
  async createLiveSession(sdp: string, callerContext: { greeting: string; callerKnown: boolean }) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required to start GPT-Live-1.');
    }

    return this.openai.live.create({
      session: {
        model: 'gpt-live-1',
        instructions: [
          'You are the warm, concise voice receptionist for Purnell Motors in Australia.',
          `Open the call by saying exactly this greeting, then pause and listen: ${callerContext.greeting}`,
          callerContext.callerKnown
            ? 'The incoming number uniquely matches a registered customer. Start with the provided greeting, which addresses them by their preferred name. Treat the caller as verified and help them directly using only that matched customer record. Do not ask for their name, vehicle registration, or phone number for verification. Never reveal any other customer record.'
            : 'The incoming number does not match a customer record. Ask for the caller full name and vehicle registration, then verify both against the same CRM record using verifyPentanaCustomer before providing any customer service. If verification fails, explain that Purnell services the registered customer only and offer to take a message for registration assistance. Do not collect service details, create requests, or discuss any customer record before verification.',
          'Speak naturally in Australian English. Answer simple conversational questions directly. For customer verification/profile, repair orders, parts status, appointment availability, staff availability, and callback or staff handoff, delegate to the application backend before answering. Use the backend result; never invent dealership or customer information.',
          'The backend can verify and look up CRM records, query available appointment slots, check staff availability, and record a callback or handoff. It cannot create or confirm a service booking. Never say a booking is made unless a connected booking tool confirms it.',
          'If the caller clearly says goodbye, asks to hang up, or says they are finished, respond with a brief polite farewell and then stop. The application will close the session after your farewell audio finishes. Do not keep asking follow-up questions.',
          'Never invent dealership or customer information. Follow the backend result and do not reveal personal data unless the caller is verified. A caller may only receive information belonging to the single customer record verified for them; never reveal or confirm another customer record.',
        ].join(' '),
        audio: { output: { voice: 'ripple' } },
        delegation: { type: 'client' },
      },
      transport: { type: 'webrtc', sdp },
    });
  }

  /**
   * Available function-calling tools for the brain
   */
  getAvailableTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'verifyPentanaCustomer',
          description:
            'Verify an unknown or third-party caller by checking that their customer full name and vehicle registration belong to the same Pentana CRM record. Never use this result to disclose details unless verified is true.',
          parameters: {
            type: 'object',
            properties: {
              customerName: {
                type: 'string',
                description: 'Customer full name supplied by the caller.',
              },
              registration: {
                type: 'string',
                description: 'Vehicle registration plate supplied by the caller.',
              },
            },
            required: ['customerName', 'registration'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lookupPentanaCustomer',
          description:
            'Look up customer details, open Repair Orders (RO), parts arrival status, or appointment from Pentana CRM by phone number, customer full name, preferred name, or vehicle registration plate (rego).',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'Caller phone number, vehicle registration plate (e.g. CF62ZZ), or customer name (e.g. Jacob Wilson, Sarah Chen).',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'checkStaffAvailability',
          description:
            'Check real-time availability status of a named dealership staff member.',
          parameters: {
            type: 'object',
            properties: {
              staffName: {
                type: 'string',
                description:
                  'Name of the staff member (e.g. Kamal, Jacob, Paul, Nate, Amina, Geoff).',
              },
            },
            required: ['staffName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'queryAppointmentSlots',
          description:
            'Query confirmed available service or test-drive appointment slots.',
          parameters: {
            type: 'object',
            properties: {
              preferredDay: {
                type: 'string',
                description: 'Optional preferred day or date.',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'createHandoffRecord',
          description:
            'Log an auditable handoff record for callbacks or staff transfers when request cannot be completed directly.',
          parameters: {
            type: 'object',
            properties: {
              intentLabel: { type: 'string' },
              callerName: { type: 'string' },
              callbackNumber: { type: 'string' },
              vehicle: { type: 'string' },
              reason: { type: 'string' },
              urgency: {
                type: 'string',
                enum: ['Low', 'Medium', 'High', 'Safety'],
              },
              destination: { type: 'string' },
              transferOutcome: {
                type: 'string',
                enum: ['Completed', 'Failed', 'Callback created'],
              },
              promisedCallbackWindow: { type: 'string' },
            },
            required: [
              'intentLabel',
              'callerName',
              'callbackNumber',
              'reason',
              'urgency',
              'destination',
            ],
          },
        },
      },
    ];
  }

  /**
   * Execute tool call locally against CustomerDatabaseService (MongoDB) and PentanaService
   */
  async executeToolCall(
    name: string,
    args: Record<string, unknown>,
    authorizedCustomerId?: string,
  ): Promise<string> {
    const toolStart = Date.now();
    try {
      let result: string;
      switch (name) {
        case 'verifyPentanaCustomer': {
          const payload = args as VerifyCustomerArgs;
          const customerName =
            typeof payload.customerName === 'string'
              ? payload.customerName.trim()
              : '';
          const registration =
            typeof payload.registration === 'string'
              ? payload.registration.trim()
              : '';

          if (!customerName || !registration) {
            result = JSON.stringify({
              verified: false,
              message:
                'I could not verify those details. Purnell services registered customers only. I can take a message for our team to help with registration.',
            });
            break;
          }

          const [nameProfile, registrationProfile] = await Promise.all([
            this.customerDatabaseService.getFullCustomerProfile(customerName),
            this.customerDatabaseService.getFullCustomerProfile(registration),
          ]);
          const nameCustomer = nameProfile?.customer;
          const registrationCustomer = registrationProfile?.customer;

          if (
            !nameCustomer ||
            !registrationCustomer ||
            nameCustomer.customer_id !== registrationCustomer.customer_id
          ) {
            result = JSON.stringify({
              verified: false,
              message:
                'I could not verify those details. Purnell services registered customers only. I can take a message for our team to help with registration.',
            });
            break;
          }

          result = JSON.stringify({
            verified: true,
            customer: {
              customer_id: nameCustomer.customer_id,
              customer_name: nameCustomer.customer_name,
              preferred_name: nameCustomer.preferred_name,
              mobile: nameCustomer.mobile,
              landline: nameCustomer.landline,
              vehicles: nameCustomer.vehicles,
              repair_orders: nameProfile?.repair_orders || [],
              service_bookings: nameProfile?.service_bookings || [],
              parts_orders: nameProfile?.parts_orders || [],
              authorised_contacts: nameProfile?.authorised_contacts || null,
            },
          });
          break;
        }

        case 'lookupPentanaCustomer': {
          if (!authorizedCustomerId) {
            result = JSON.stringify({
              found: false,
              message: 'Caller verification is required before customer records can be accessed.',
            });
            break;
          }
          const payload = args as LookupCustomerArgs;
          const query = typeof payload.query === 'string' ? payload.query : '';

          // 1. Try CustomerDatabaseService (MongoDB Atlas)
          const profile =
            await this.customerDatabaseService.getFullCustomerProfile(query);
          if (profile && profile.customer) {
            const c = profile.customer;
            if (c.customer_id !== authorizedCustomerId) {
              result = JSON.stringify({
                found: false,
                message: 'That customer record is not available for this caller.',
              });
              break;
            }
            const v =
              c.vehicles && c.vehicles.length > 0 ? c.vehicles[0] : null;
            const vDesc = v
              ? `${v.year || ''} ${v.make || ''} ${v.model || ''} (Rego: ${v.rego || ''})`.trim()
              : 'Vehicle on file';
            const ro =
              profile.repair_orders && profile.repair_orders.length > 0
                ? profile.repair_orders[0]
                : null;
            const bk =
              profile.service_bookings && profile.service_bookings.length > 0
                ? profile.service_bookings[0]
                : null;
            const pt =
              profile.parts_orders && profile.parts_orders.length > 0
                ? profile.parts_orders[0]
                : null;
            const ptDesc =
              pt && pt.lines && pt.lines.length > 0
                ? `${pt.parts_order_id} (${pt.lines[0].description || 'Parts'} — ${pt.lines[0].status || 'Ordered'})`
                : pt
                  ? pt.parts_order_id
                  : 'None';

            const log = `[PENTANA / DMS LOOKUP]\n✓ Record found in Pentana CRM for "${query}":\nCustomer: ${c.customer_name} (ID: ${c.customer_id})\nVehicle: ${vDesc}\nOpen RO: ${ro ? `RO #${ro.ro_number} (${ro.status} — Advisor: ${ro.advisor})` : 'None'}\nUpcoming Booking: ${bk ? `${bk.date} at ${bk.time} (${bk.job_type})` : 'None'}\nParts Order: ${ptDesc}`;

            result = JSON.stringify({
              found: true,
              simulatedLog: log,
              customer: {
                customer_id: c.customer_id,
                customer_name: c.customer_name,
                preferred_name: c.preferred_name,
                mobile: c.mobile,
                landline: c.landline,
                vehicles: c.vehicles,
                repair_orders: profile.repair_orders,
                service_bookings: profile.service_bookings,
                parts_orders: profile.parts_orders,
                authorised_contacts: profile.authorised_contacts,
              },
            });
            break;
          }

          // Static demo records have no customer ID to bind to the verified
          // CRM identity, so never expose them through this tool.
          result = JSON.stringify({
            found: false,
            message: 'No matching customer record is available for this verified account.',
          });
          break;
        }

        case 'checkStaffAvailability': {
          const payload = args as StaffAvailabilityArgs;
          const staffName =
            typeof payload.staffName === 'string' ? payload.staffName : '';
          const staff = this.pentanaService.checkStaff(staffName);
          if (!staff) {
            result = JSON.stringify({
              found: false,
              message: `Staff member "${staffName}" not found in dealership registry.`,
            });
            break;
          }
          result = JSON.stringify({
            found: true,
            name: staff.name,
            role: staff.role,
            status: staff.status,
            department: staff.department,
          });
          break;
        }

        case 'queryAppointmentSlots': {
          result = JSON.stringify({
            slots: this.pentanaService
              .getAppointmentSlots()
              .filter((s: AppointmentSlot) => s.available),
          });
          break;
        }

        case 'createHandoffRecord': {
          const formatted = this.pentanaService.formatHandoffRecord(args);
          this.logger.log(`Created Handoff Record:\n${formatted}`);
          result = JSON.stringify({
            success: true,
            handoffRecord: formatted,
          });
          break;
        }

        default:
          result = JSON.stringify({ error: `Unknown tool ${name}` });
          break;
      }
      const duration = Date.now() - toolStart;
      this.logger.log(`[Tool Call] "${name}" executed in ${duration}ms`);
      return result;
    } catch (err: unknown) {
      const duration = Date.now() - toolStart;
      this.logger.error(`Error executing tool call ${name} after ${duration}ms:`, err);
      return JSON.stringify({
        found: false,
        error: `Tool execution failed: ${String(err)}`,
      });
    }
  }

  async generateResponse(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    customerContext?: string,
    initialAuthorizedCustomerId?: string,
  ): Promise<{ text: string; toolLogs?: string[]; timings?: OpenAiResponseTimings }> {
    const overallStart = Date.now();
    let systemPrompt = this.getSystemPrompt();
    if (customerContext) {
      systemPrompt += "\n\nCURRENT INBOUND CALLER CONTEXT (INJECTED BY CRM):\n" + customerContext;
    }

    const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const toolLogs: string[] = [];
    const llmCallsMs: number[] = [];
    const toolCalls: ToolCallTiming[] = [];
    const maxToolIterations = 5;
    let authorizedCustomerId = initialAuthorizedCustomerId;

    for (let iteration = 1; iteration <= maxToolIterations; iteration++) {
      const callStartedAt = Date.now();
      try {
        const response = await this.openai.chat.completions.create({
          model: this.config.model,
          messages: currentMessages,
          tools: this.getAvailableTools(),
          temperature: this.config.temperature,
        });
        llmCallsMs.push(Date.now() - callStartedAt);

        const message = response.choices[0]?.message;
        if (!message) break;
        if (message.tool_calls?.length) {
          currentMessages.push(message);
          for (const toolCall of message.tool_calls) {
            if (!('function' in toolCall) || !toolCall.function) continue;
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
            } catch {
              // Invalid arguments are handled by the tool with empty defaults.
            }

            if (
              !authorizedCustomerId &&
              toolCall.function.name !== 'verifyPentanaCustomer'
            ) {
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  authorized: false,
                  message: 'Verify the caller as a registered customer before providing service or accessing customer records.',
                }),
              });
              continue;
            }

            const toolStartedAt = Date.now();
            const result = await this.executeToolCall(
              toolCall.function.name,
              args,
              authorizedCustomerId,
            );
            if (toolCall.function.name === 'verifyPentanaCustomer') {
              try {
                const verification = JSON.parse(result) as {
                  verified?: boolean;
                  customer?: { customer_id?: string };
                };
                authorizedCustomerId = verification.verified
                  ? verification.customer?.customer_id
                  : undefined;
              } catch {
                authorizedCustomerId = undefined;
              }
            }
            toolCalls.push({ name: toolCall.function.name, durationMs: Date.now() - toolStartedAt });
            try {
              const parsed = JSON.parse(result) as ParsedToolResult;
              if (typeof parsed.simulatedLog === 'string') toolLogs.push(parsed.simulatedLog);
            } catch {
              // Tool results still go to the model when they are not JSON.
            }
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
          }
          continue;
        }

        if (message.content?.trim()) {
          const totalMs = Date.now() - overallStart;
          this.logger.log(
            "[OpenAiService] Response generated in " + totalMs + "ms (model: " + this.config.model +
            ", iterations: " + iteration + ", toolCalls: " + toolCalls.length + ")",
          );
          return {
            text: message.content.trim(),
            toolLogs,
            timings: { totalMs, iterations: iteration, llmCallsMs, toolCalls },
          };
        }
        break;
      } catch (error) {
        llmCallsMs.push(Date.now() - callStartedAt);
        this.logger.error("OpenAI completion error on iteration " + iteration + ".", error);
        break;
      }
    }

    return {
      text: 'Purnell Motors, Blakehurst. May I please have your name and vehicle registration plate so I can pull up your file, and how may I assist you today?',
      toolLogs,
      timings: {
        totalMs: Date.now() - overallStart,
        iterations: llmCallsMs.length,
        llmCallsMs,
        toolCalls,
      },
    };
  }
}
