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
  private formattedSystemPrompt: string = '';

  constructor(private readonly pentanaService: PentanaService) {
    this.openai = new OpenAI({
      apiKey: this.config.apiKey,
    });
    this.loadAndFormatSystemPrompt();
    this.logger.log(
      `OpenAI Brain Service initialized (Model: ${this.config.model})`,
    );
  }

  /**
   * Loads System Prompt.md and KB.md from project root and compiles a structured prompt
   */
  public loadAndFormatSystemPrompt(): string {
    try {
      const rootDir = process.cwd();
      const systemPromptPath = path.join(rootDir, 'System Prompt.md');
      const kbPath = path.join(rootDir, 'KB.md');

      let systemPromptContent = '';
      let kbContent = '';

      if (fs.existsSync(systemPromptPath)) {
        systemPromptContent = fs.readFileSync(systemPromptPath, 'utf8');
      }
      if (fs.existsSync(kbPath)) {
        kbContent = fs.readFileSync(kbPath, 'utf8');
      }

      this.formattedSystemPrompt = `
You are the AI Receptionist for Purnell Motors Pty Ltd, a luxury automotive dealership in Blakehurst, NSW, representing Jaguar Land Rover (JLR) and INEOS / Jaecoo (JQ) brands.

### OPERATIONAL CORE & TONE
- Tone: Professional, calm, warm, and knowledgeable — luxury automotive standard. Australian English. Never robotic, rushed, or dismissive.
- Voice Cadence: Concise, helpful, composed (Australian accent nuances respected).
- Interruption Behavior: When a caller interrupts or changes the topic mid-sentence, acknowledge their new input naturally and immediately answer their new query.
- Real-time VAD parameters active: 0.7 threshold, 300ms prefix padding, 1000ms silence duration, 500ms barge-in grace window.

### CRITICAL RULES (NEVER VIOLATE)
1. **Real Data Only**: Never invent service slots, fitment times, staff availability, stock presence, loan cars, or parts status.
2. **Do Not Transact**: Never quote drive-away prices, finance rates, parts prices, deposit amounts, settlement figures, or bank details.
3. **Be Honest About People**: If a staff member is not confirmed available, create a 10–30 min callback with accurate ownership.
4. **Safety Overrides Convenience**: If a caller reports driving danger (smoke, warning light, rattle), tell them to pull over safely immediately and give:
   - Land Rover / Range Rover / Defender / INEOS: 1800 808 180
   - Jaguar: 1800 819 181
5. **Brand & Site Routing**:
   - Jaecoo / JQ / INEOS Grenadier: 996 King Georges Road
   - Jaguar / Land Rover / Range Rover / Defender: 990 King Georges Road
6. **Trading Hours**:
   - Mon–Sat: Open until 5:00 PM (Last test drive 4:00 PM).
   - Saturday/After-hours service bookings: Collect details only; advise service team will call Monday.
   - Sunday: Fully closed.
7. **Simulated Pentana Lookups**: In testing mode, output simulated lookup blocks when accessing data:
   [PENTANA LOOKUP — simulated]

### SYSTEM PROMPT REFERENCE:
${systemPromptContent}

### KNOWLEDGE BASE REFERENCE:
${kbContent}
      `.trim();

      return this.formattedSystemPrompt;
    } catch (error: unknown) {
      this.logger.error('Failed to load system prompt / KB files', error);
      this.formattedSystemPrompt =
        'You are the AI Receptionist for Purnell Motors Pty Ltd.';
      return this.formattedSystemPrompt;
    }
  }

  /**
   * Returns current formatted system prompt
   */
  getSystemPrompt(): string {
    if (!this.formattedSystemPrompt) {
      return this.loadAndFormatSystemPrompt();
    }
    return this.formattedSystemPrompt;
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
   * Execute tool call locally against Pentana service
   */
  executeToolCall(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case 'lookupPentanaCustomer': {
        const payload = args as LookupCustomerArgs;
        const query = typeof payload.query === 'string' ? payload.query : '';
        const customer = this.pentanaService.searchCustomer(query);
        if (!customer) {
          return JSON.stringify({
            found: false,
            message: `[PENTANA LOOKUP — simulated]\nSearching customer records for query: "${query}"...\n✗ No matching record found in Pentana.`,
          });
        }
        return JSON.stringify({
          found: true,
          simulatedLog: `[PENTANA LOOKUP — simulated]\nSearching customer records for query: ${query}...\n✓ Match found: ${customer.name} | ${customer.vehicle} | Rego: ${customer.rego}\nOpen RO: ${customer.openRo || 'None'} | Parts: ${customer.partsStatus || 'None'} | Next Appt: ${customer.nextAppointment || 'None'}`,
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
   * Generates AI brain text response given conversation history
   */
  async generateResponse(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): Promise<{ text: string; toolLogs?: string[] }> {
    const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: 'system',
      content: this.getSystemPrompt(),
    };

    const fullMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      systemMessage,
      ...messages,
    ];
    const tools = this.getAvailableTools();

    const response = await this.openai.chat.completions.create({
      model: this.config.model,
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
          const toolResult = this.executeToolCall(toolName, toolArgs);

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
        model: this.config.model,
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
