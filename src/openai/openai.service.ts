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
                'Unable to verify those details. Please check the information and try again.',
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
                'Unable to verify those details. Please check the information and try again.',
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

          // 2. Fallback to static mock data in PentanaService
          const customer = this.pentanaService.searchCustomer(query);
          if (!customer) {
            result = JSON.stringify({
              found: false,
              message: `[PENTANA LOOKUP]\nSearching customer records for query: "${query}"...\n✗ No matching record found in Pentana CRM. Please check by customer full name or vehicle registration plate.`,
            });
            break;
          }
          result = JSON.stringify({
            found: true,
            simulatedLog: `[PENTANA LOOKUP]\n✓ Match found: ${customer.name} | ${customer.vehicle} | Rego: ${customer.rego}\nOpen RO: ${customer.openRo || 'None'} | Parts: ${customer.partsStatus || 'None'} | Next Appt: ${customer.nextAppointment || 'None'}`,
            customer,
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
   * Helper to extract complete sentences from streaming text buffer
   */
  private extractReadySentences(buffer: string): {
    sentences: string[];
    remaining: string;
  } {
    const sentences: string[] = [];
    let remaining = buffer;

    // Match sentences ending with punctuation followed by space or newline
    const sentenceRegex = /^(.*?[.!?])(?:\s+|\n+)(.*)$/s;
    while (true) {
      const match = remaining.match(sentenceRegex);
      if (!match) break;
      const sentence = match[1].trim();
      // Avoid splitting prematurely on common abbreviations
      if (
        sentence.length >= 10 &&
        !/(?:Ltd|Mr|Mrs|Ms|Dr|RO|NSW|Pty|St|Ave|Rd)\.$/i.test(sentence)
      ) {
        sentences.push(sentence);
        remaining = match[2];
      } else {
        break;
      }
    }

    return { sentences, remaining };
  }

  /**
   * Generates AI brain text response with real-time sentence streaming support
   */
  async generateResponse(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    customerContext?: string,
    onSentenceChunk?: (sentence: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<{ text: string; toolLogs?: string[]; timings?: OpenAiResponseTimings }> {
    const overallStart = Date.now();
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
    const toolLogs: string[] = [];
    const llmCallsMs: number[] = [];
    const toolCalls: ToolCallTiming[] = [];

    const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [...fullMessages];
    const maxToolIterations = 5;
    let iteration = 0;

    while (iteration < maxToolIterations) {
      iteration++;
      const llmCallStart = Date.now();

      try {
        if (onSentenceChunk) {
          // Streaming mode for instant sentence-by-sentence TTS delivery
          const stream = await this.openai.chat.completions.create(
            {
              model: chatModel,
              messages: currentMessages,
              tools,
              temperature: this.config.temperature,
              stream: true,
            },
            { signal: abortSignal },
          );

          let streamedContent = '';
          let pendingBuffer = '';
          const pendingToolCalls: Map<
            number,
            { id: string; name: string; arguments: string }
          > = new Map();

          for await (const chunk of stream) {
            if (abortSignal?.aborted) break;

            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              streamedContent += delta.content;
              pendingBuffer += delta.content;

              const { sentences, remaining } =
                this.extractReadySentences(pendingBuffer);
              for (const sentence of sentences) {
                if (sentence.length > 0) {
                  onSentenceChunk(sentence);
                }
              }
              pendingBuffer = remaining;
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                const existing = pendingToolCalls.get(idx) || {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  arguments: '',
                };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
                pendingToolCalls.set(idx, existing);
              }
            }
          }

          const llmDuration = Date.now() - llmCallStart;
          llmCallsMs.push(llmDuration);

          // If tool calls were requested, execute them and continue iteration
          if (pendingToolCalls.size > 0) {
            const toolCallArray = Array.from(pendingToolCalls.values()).map(
              (tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              }),
            );

            currentMessages.push({
              role: 'assistant',
              content: streamedContent || null,
              tool_calls: toolCallArray,
            });

            for (const tc of toolCallArray) {
              let toolArgs: Record<string, unknown> = {};
              try {
                toolArgs = JSON.parse(
                  tc.function.arguments || '{}',
                ) as Record<string, unknown>;
              } catch {
                toolArgs = {};
              }

              const toolStart = Date.now();
              const toolResult = await this.executeToolCall(
                tc.function.name,
                toolArgs,
              );
              const toolDuration = Date.now() - toolStart;
              toolCalls.push({
                name: tc.function.name,
                durationMs: toolDuration,
              });

              try {
                const parsed = JSON.parse(toolResult) as ParsedToolResult;
                if (typeof parsed.simulatedLog === 'string') {
                  toolLogs.push(parsed.simulatedLog);
                }
              } catch {
                // ignore
              }

              currentMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: toolResult,
              });
            }
            continue;
          }

          // Flush any final remaining text
          if (pendingBuffer.trim().length > 0 && !abortSignal?.aborted) {
            onSentenceChunk(pendingBuffer.trim());
          }

          if (streamedContent && streamedContent.trim().length > 0) {
            const totalMs = Date.now() - overallStart;
            const totalLlmTime = llmCallsMs.reduce((a, b) => a + b, 0);
            const totalToolsTime = toolCalls.reduce(
              (a, b) => a + b.durationMs,
              0,
            );
            this.logger.log(
              `[OpenAiService] Streamed response generated in ${totalMs}ms (model: ${chatModel}, iterations: ${iteration}, llmTime: ${totalLlmTime}ms, toolsTime: ${totalToolsTime}ms, toolCalls: ${toolCalls.length})`,
            );
            return {
              text: streamedContent.trim(),
              toolLogs,
              timings: {
                totalMs,
                iterations: iteration,
                llmCallsMs,
                toolCalls,
              },
            };
          }
        } else {
          // Standard non-streaming mode
          const response = await this.openai.chat.completions.create(
            {
              model: chatModel,
              messages: currentMessages,
              tools,
              temperature: this.config.temperature,
            },
            { signal: abortSignal },
          );

          const llmDuration = Date.now() - llmCallStart;
          llmCallsMs.push(llmDuration);

          const choice = response.choices[0];
          const message = choice?.message;
          if (!message) break;

          // If the model invoked tools, execute them and continue the reasoning loop
          if (message.tool_calls && message.tool_calls.length > 0) {
            currentMessages.push(message);

            for (const toolCall of message.tool_calls) {
              if ('function' in toolCall && toolCall.function) {
                const toolName = toolCall.function.name;
                let toolArgs: Record<string, unknown> = {};
                try {
                  toolArgs = JSON.parse(
                    toolCall.function.arguments || '{}',
                  ) as Record<string, unknown>;
                } catch {
                  toolArgs = {};
                }

                const toolStart = Date.now();
                const toolResult = await this.executeToolCall(
                  toolName,
                  toolArgs,
                );
                const toolDuration = Date.now() - toolStart;
                toolCalls.push({ name: toolName, durationMs: toolDuration });

                try {
                  const parsed = JSON.parse(toolResult) as ParsedToolResult;
                  if (typeof parsed.simulatedLog === 'string') {
                    toolLogs.push(parsed.simulatedLog);
                  }
                } catch {
                  // ignore
                }

                currentMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: toolResult,
                });
              }
            }
            continue;
          }

          // Return final text response from the model
          if (message.content && message.content.trim().length > 0) {
            const totalMs = Date.now() - overallStart;
            const totalLlmTime = llmCallsMs.reduce((a, b) => a + b, 0);
            const totalToolsTime = toolCalls.reduce(
              (a, b) => a + b.durationMs,
              0,
            );
            this.logger.log(
              `[OpenAiService] Response generated in ${totalMs}ms (model: ${chatModel}, iterations: ${iteration}, llmTime: ${totalLlmTime}ms, toolsTime: ${totalToolsTime}ms, toolCalls: ${toolCalls.length})`,
            );
            return {
              text: message.content.trim(),
              toolLogs,
              timings: {
                totalMs,
                iterations: iteration,
                llmCallsMs,
                toolCalls,
              },
            };
          }
        }

        break;
      } catch (err: unknown) {
        const llmDuration = Date.now() - llmCallStart;
        llmCallsMs.push(llmDuration);
        this.logger.error(
          `OpenAI completion error on iteration ${iteration} after ${llmDuration}ms:`,
          err,
        );
        break;
      }
    }

    const totalMs = Date.now() - overallStart;
    // Safe fallback if loop terminated without content
    return {
      text: 'Purnell Motors, Blakehurst. May I please have your name and vehicle registration plate so I can pull up your file, and how may I assist you today?',
      toolLogs,
      timings: {
        totalMs,
        iterations: iteration,
        llmCallsMs,
        toolCalls,
      },
    };
  }
}
