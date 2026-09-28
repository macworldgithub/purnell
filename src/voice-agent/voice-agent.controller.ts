import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
} from '@nestjs/common';
import { OpenAiService } from '../openai/openai.service';
import { ConversationTurn, VoiceAgentService } from './voice-agent.service';

type DelegationResponse = {
  success: boolean;
  response: string;
  timings?: unknown;
};

@Controller('voice-agent/live')
export class VoiceAgentController {
  private readonly logger = new Logger(VoiceAgentController.name);

  constructor(
    private readonly voiceAgentService: VoiceAgentService,
    private readonly openAiService: OpenAiService,
  ) {}

  @Post('session')
  async createSession(@Body('sdp') sdp: string, @Body('cli') cli?: string) {
    if (!sdp || typeof sdp !== 'string') {
      throw new BadRequestException('A WebRTC SDP offer is required.');
    }

    try {
      this.logger.log('Creating GPT-Live-1 WebRTC session.');
      const callerContext = await this.voiceAgentService.getLiveCallerContext(cli || '');
      const session = await this.openAiService.createLiveSession(sdp, callerContext);
      this.logger.log(`GPT-Live-1 session created (sessionId: ${session.session.id}).`);
      return { success: true, session: session.session, transport: session.transport };
    } catch (error) {
      this.logger.error('GPT-Live-1 session creation failed.', error);
      throw new BadGatewayException(
        error instanceof Error ? error.message : 'Unable to create the GPT-Live-1 session.',
      );
    }
  }

  @Post('delegation')
  async processDelegation(
    @Body('message') message: string,
    @Body('history') history?: ConversationTurn[],
    @Body('cli') cli?: string,
  ) {
    if (!message?.trim()) {
      throw new BadRequestException('A transcript is required for delegation.');
    }

    const startedAt = Date.now();
    this.logger.log(`Delegation received (transcriptCharacters: ${message.trim().length}).`);
    try {
      const result = await this.voiceAgentService.processTextMessage(message, history || [], cli || '');
      const toolSummary = (result.timings?.toolCalls || [])
        .map(({ name, durationMs }) => `${name}:${durationMs}ms`)
        .join(', ') || 'none';
      this.logger.log(
        `Delegation completed in ${Date.now() - startedAt}ms (tools: ${toolSummary}).`,
      );
      return { success: true, response: result.text, timings: result.timings } as DelegationResponse;
    } catch (error) {
      this.logger.error(`Delegation failed after ${Date.now() - startedAt}ms.`, error);
      throw error;
    }
  }
}
