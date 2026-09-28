import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Logger,
  Post,
  Body,
} from '@nestjs/common';
import { VoiceAgentService, ConversationTurn } from './voice-agent.service';
import { HandoffRecord } from '../pentana/pentana.data';
import { OpenAiService } from '../openai/openai.service';

@Controller('voice-agent')
export class VoiceAgentController {
  private readonly logger = new Logger(VoiceAgentController.name);

  constructor(
    private readonly voiceAgentService: VoiceAgentService,
    private readonly openAiService: OpenAiService,
  ) {}

  @Post('live/session')
  async createLiveSession(@Body('sdp') sdp: string, @Body('cli') cli?: string) {
    if (!sdp || typeof sdp !== 'string') {
      throw new BadRequestException('A WebRTC SDP offer is required.');
    }

    try {
      this.logger.log('Creating GPT-Live-1 WebRTC session.');
      const callerContext = await this.voiceAgentService.getLiveCallerContext(cli || '');
      const session = await this.openAiService.createLiveSession(sdp, callerContext);
      this.logger.log(`GPT-Live-1 session created (sessionId: ${session.session.id}).`);
      return {
        success: true,
        session: session.session,
        transport: session.transport,
      };
    } catch (error) {
      this.logger.error('GPT-Live-1 session creation failed.', error);
      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Unable to create the GPT-Live-1 session.',
      );
    }
  }

  @Post('live/delegation')
  async processLiveDelegation(
    @Body('message') message: string,
    @Body('history') history?: ConversationTurn[],
    @Body('cli') cli?: string,
  ) {
    if (!message?.trim()) {
      throw new BadRequestException('A transcript is required for delegation.');
    }

    const startedAt = Date.now();
    this.logger.log(`GPT-Live delegation received (transcriptCharacters: ${message.trim().length}).`);
    try {
      const result = await this.voiceAgentService.processTextMessage(
        message,
        history || [],
        cli || '',
        false,
      );
      const toolCalls = result.timings?.toolCalls || [];
      const toolSummary = toolCalls
        .map((toolCall) => `${toolCall.name}:${toolCall.durationMs}ms`)
        .join(', ') || 'none';
      this.logger.log(
        `GPT-Live delegation completed in ${Date.now() - startedAt}ms (responseCharacters: ${result.text.length}, tools: ${toolSummary}).`,
      );
      return { success: true, response: result.text, timings: result.timings };
    } catch (error) {
      this.logger.error(`GPT-Live delegation failed after ${Date.now() - startedAt}ms.`, error);
      throw error;
    }
  }

  @Get('config')
  getConfig() {
    const config = this.voiceAgentService.getConfig();
    return {
      success: true,
      elevenlabs: {
        model: config.elevenlabs.model,
        outputFormat: config.elevenlabs.outputFormat,
        voiceId: config.elevenlabs.voiceId,
        voiceSettings: config.elevenlabs.voiceSettings,
      },
      openai: {
        model: config.openai.model,
        vad: config.openai.vad,
      },
      deepgram: {
        model: config.deepgram.model,
        language: config.deepgram.language,
        encoding: config.deepgram.encoding,
        sampleRate: config.deepgram.sample_rate,
      },
    };
  }

  @Get('system-prompt')
  getSystemPrompt() {
    return {
      success: true,
      systemPrompt: this.voiceAgentService.getFormattedSystemPrompt(),
    };
  }

  @Post('lookup')
  lookupCustomer(@Body('query') query: string) {
    const customer = this.voiceAgentService.lookupCustomer(query);
    return {
      success: true,
      found: Boolean(customer),
      customer: customer || 'No record found in Pentana.',
    };
  }

  @Post('staff')
  checkStaff(@Body('name') name: string) {
    const staff = this.voiceAgentService.checkStaff(name);
    return {
      success: true,
      found: Boolean(staff),
      staff: staff || 'Staff member not found.',
    };
  }

  @Get('appointments')
  getAppointments() {
    return {
      success: true,
      slots: this.voiceAgentService.getAppointmentSlots(),
    };
  }

  @Post('handoff')
  createHandoff(@Body() record: Partial<HandoffRecord>) {
    const formatted = this.voiceAgentService.createHandoff(record);
    return {
      success: true,
      handoffRecord: formatted,
    };
  }

  @Post('start')
  async startCall(@Body('cli') cli?: string) {
    const result = await this.voiceAgentService.generateInitialGreeting(
      cli || '',
    );
    return {
      success: true,
      greeting: result.text,
      hasAudio: Boolean(result.audioBuffer),
      audioBuffer: result.audioBuffer,
      customer: result.customer,
      timings: result.timings,
    };
  }

  @Post('chat')
  async testChat(
    @Body('message') message: string,
    @Body('history') history?: ConversationTurn[],
    @Body('cli') cli?: string,
  ) {
    const result = await this.voiceAgentService.processTextMessage(
      message,
      history || [],
      cli || '',
    );
    return {
      success: true,
      response: result.text,
      toolLogs: result.toolLogs || [],
      hasAudio: Boolean(result.audioBuffer),
      audioBuffer: result.audioBuffer,
      timings: result.timings,
    };
  }
}
