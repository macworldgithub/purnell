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

interface StaffAvailabilityArgs {
  staffName?: string;
}

interface ParsedToolResult {
  simulatedLog?: string;
  found?: boolean;
  success?: boolean;
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
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
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

  /**
   * Returns OpenAI Realtime session configuration
   */
  getRealtimeSessionConfig(): Record<string, unknown> {
    return {
      model: this.config.model,
      modalities: ['text', 'audio'],
      instructions: this.getSystemPrompt(),
      turn_detection: {
        type: this.config.vad.type,
        threshold: this.config.vad.threshold,
        prefix_padding_ms: this.config.vad.prefix_padding_ms,
        silence_duration_ms: this.config.vad.silence_duration_ms,
        barge_in_grace_ms: this.config.vad.barge_in_grace_ms,
      },
      temperature: this.config.temperature,
      tools: this.getAvailableTools(),
    };
  }

  /**
   * Available function-calling tools for the brain
   */
  getAvailableTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'lookupPentanaCustomer',
          description:
            'Look up customer details, open Repair Orders (RO), parts arrival status, or appointment from Pentana by phone, name, or registration.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'Caller phone number, vehicle registration plate, or customer full name.',
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
  ): Promise<string> {
    switch (name) {
      case 'lookupPentanaCustomer': {
        const payload = args as LookupCustomerArgs;
        const query = typeof payload.query === 'string' ? payload.query : '';

        // 1. Try CustomerDatabaseService (MongoDB Atlas)
        const profile =
          await this.customerDatabaseService.getFullCustomerProfile(query);
        if (profile && profile.customer) {
          const c = profile.customer;
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

          return JSON.stringify({
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
        }

        // 2. Fallback to static mock data in PentanaService
        const customer = this.pentanaService.searchCustomer(query);
        if (!customer) {
          return JSON.stringify({
            found: false,
            message: `[PENTANA LOOKUP]\nSearching customer records for query: "${query}"...\n✗ No matching record found in Pentana CRM.`,
          });
        }
        return JSON.stringify({
          found: true,
          simulatedLog: `[PENTANA LOOKUP]\n✓ Match found: ${customer.name} | ${customer.vehicle} | Rego: ${customer.rego}\nOpen RO: ${customer.openRo || 'None'} | Parts: ${customer.partsStatus || 'None'} | Next Appt: ${customer.nextAppointment || 'None'}`,
          customer,
        });
      }

      case 'checkStaffAvailability': {
        const payload = args as StaffAvailabilityArgs;
        const staffName =
          typeof payload.staffName === 'string' ? payload.staffName : '';
        const staff = this.pentanaService.checkStaff(staffName);
        if (!staff) {
          return JSON.stringify({
            found: false,
            message: `Staff member "${staffName}" not found in dealership registry.`,
          });
        }
        return JSON.stringify({
          found: true,
          name: staff.name,
          role: staff.role,
          status: staff.status,
          department: staff.department,
        });
      }

      case 'queryAppointmentSlots': {
        return JSON.stringify({
          slots: this.pentanaService
            .getAppointmentSlots()
            .filter((s: AppointmentSlot) => s.available),
        });
      }

      case 'createHandoffRecord': {
        const formatted = this.pentanaService.formatHandoffRecord(args);
        this.logger.log(`Created Handoff Record:\n${formatted}`);
        return JSON.stringify({
          success: true,
          handoffRecord: formatted,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool ${name}` });
    }
  }

  /**
   * Helper to ensure a chat-compatible model is used for completions
   */
  private getChatModel(): string {
    const configured = this.config.model || 'gpt-4o-mini';
    if (configured.includes('realtime')) {
      return 'gpt-4o-mini';
    }
    return configured;
  }

  /**
   * Generates AI brain text response given conversation history and verified caller context
   */
  async generateResponse(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    customerContext?: string,
  ): Promise<{ text: string; toolLogs?: string[] }> {
    let systemPromptContent = this.getSystemPrompt();
    if (customerContext) {
      systemPromptContent += `\n\n===============================================================================\nCURRENT INBOUND CALLER CONTEXT (INJECTED BY CRM):\n${customerContext}\n===============================================================================`;
    }

    const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: 'system',
      content: systemPromptContent,
    };

    const fullMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      systemMessage,
      ...messages,
    ];
    const tools = this.getAvailableTools();
    const chatModel = this.getChatModel();

    const response = await this.openai.chat.completions.create({
      model: chatModel,
      messages: fullMessages,
      tools,
      temperature: this.config.temperature,
    });

    const choice = response.choices[0];
    const message = choice.message;
    const toolLogs: string[] = [];

    if (message.tool_calls && message.tool_calls.length > 0) {
      const followUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        [...fullMessages, message];

      for (const toolCall of message.tool_calls) {
        if ('function' in toolCall && toolCall.function) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(
            toolCall.function.arguments || '{}',
          ) as Record<string, unknown>;
          const toolResult = await this.executeToolCall(toolName, toolArgs);

          try {
            const parsed = JSON.parse(toolResult) as ParsedToolResult;
            if (typeof parsed.simulatedLog === 'string') {
              toolLogs.push(parsed.simulatedLog);
            }
          } catch {
            // ignore
          }

          followUpMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }
      }

      const finalResponse = await this.openai.chat.completions.create({
        model: chatModel,
        messages: followUpMessages,
        temperature: this.config.temperature,
      });

      return {
        text: finalResponse.choices[0]?.message?.content || '',
        toolLogs,
      };
    }

    return {
      text: message.content || '',
      toolLogs,
    };
  }
}
