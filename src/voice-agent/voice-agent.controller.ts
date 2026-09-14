import { Controller, Get, Post, Body } from '@nestjs/common';
import { VoiceAgentService, ConversationTurn } from './voice-agent.service';
import { HandoffRecord } from '../pentana/pentana.data';

@Controller('voice-agent')
export class VoiceAgentController {
  constructor(private readonly voiceAgentService: VoiceAgentService) {}

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

  @Post('chat')
  async testChat(
    @Body('message') message: string,
    @Body('history') history?: ConversationTurn[],
  ) {
    const result = await this.voiceAgentService.processTextMessage(
      message,
      history || [],
    );
    return {
      success: true,
      response: result.text,
      toolLogs: result.toolLogs || [],
      hasAudio: Boolean(result.audioBuffer),
    };
  }
}
