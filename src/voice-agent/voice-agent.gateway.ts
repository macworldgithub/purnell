import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { VoiceAgentService } from './voice-agent.service';

@WebSocketGateway({ path: '/voice', cors: { origin: '*' } })
export class VoiceAgentGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VoiceAgentGateway.name);
  private clientSessionMap = new Map<WebSocket, string>();

  constructor(private readonly voiceAgentService: VoiceAgentService) { }

  async handleConnection(client: WebSocket, req: any) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.clientSessionMap.set(client, sessionId);

    // Extract optional CLI query param (e.g. /voice?cli=0412000006)
    const urlStr = req?.url || '';
    const queryIdx = urlStr.indexOf('?');
    const queryString = queryIdx !== -1 ? urlStr.substring(queryIdx + 1) : '';
    const urlParams = new URLSearchParams(queryString);
    const cli = urlParams.get('cli') || urlParams.get('phone') || '';

    this.logger.log(
      `WebSocket client connected. Session ID: ${sessionId} | CLI: "${cli}"`,
    );

    try {
      await this.voiceAgentService.createSession(sessionId, {
        onTranscript: (transcript: string, isFinal: boolean) => {
          this.sendJson(client, {
            event: 'transcript',
            data: { transcript, isFinal },
          });
        },
        onAiReply: (text: string, toolLogs?: string[]) => {
          this.sendJson(client, {
            event: 'ai_reply',
            data: { text, toolLogs },
          });
        },
        onAudioChunk: (chunk: Buffer) => {
          this.sendJson(client, {
            event: 'audio_chunk',
            data: {
              chunk: chunk.toString('base64'),
              format: 'pcm_16000',
            },
          });
        },
        onBargeIn: () => {
          this.logger.log(
            `Barge-in: sending immediate stop_audio & clear_audio_buffer to client`,
          );
          this.sendJson(client, {
            event: 'stop_audio',
            data: {
              reason: 'barge_in',
              message: 'User interrupted: audio output cleared immediately.',
            },
          });
          this.sendJson(client, {
            event: 'clear_audio_buffer',
            data: { timestamp: Date.now() },
          });
        },
      });

      // Send session readiness message
      this.sendJson(client, {
        event: 'session_ready',
        data: {
          sessionId,
          cli,
          stt: 'Deepgram Nova-3 (real-time stream)',
          brain: 'OpenAI gpt-realtime-2 (with Pentana lookup & prompt data)',
          tts: 'ElevenLabs eleven_flash_v2_5 (PCM 16kHz with instant barge-in interrupt)',
        },
      });

      // Trigger backend 2-phase greeting (state CLI, lookup DB, report customer details)
      void this.voiceAgentService.sendInitialGreeting(sessionId, cli, {
        onAiReply: (text: string, toolLogs?: string[]) => {
          this.sendJson(client, {
            event: 'ai_reply',
            data: { text, toolLogs },
          });
        },
        onAudioChunk: (chunk: Buffer) => {
          this.sendJson(client, {
            event: 'audio_chunk',
            data: {
              chunk: chunk.toString('base64'),
              format: 'pcm_16000',
            },
          });
        },
      });
    } catch (error) {
      this.logger.error(`Failed to initialize session for client:`, error);
      this.sendJson(client, {
        event: 'error',
        data: { message: 'Failed to initialize voice session' },
      });
    }

    // Handle raw binary audio data sent from client
    client.on('message', (message: any, isBinary: boolean) => {
      if (isBinary && Buffer.isBuffer(message)) {
        this.voiceAgentService.handleAudioChunk(sessionId, message);
      }
    });
  }

  async handleDisconnect(client: WebSocket) {
    const sessionId = this.clientSessionMap.get(client);
    if (sessionId) {
      this.logger.log(`WebSocket client disconnected: ${sessionId}`);
      await this.voiceAgentService.closeSession(sessionId);
      this.clientSessionMap.delete(client);
    }
  }

  @SubscribeMessage('audio_chunk')
  handleAudioChunkMessage(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() payload: { base64Audio: string },
  ) {
    const sessionId = this.clientSessionMap.get(client);
    if (sessionId && payload?.base64Audio) {
      const buffer = Buffer.from(payload.base64Audio, 'base64');
      this.voiceAgentService.handleAudioChunk(sessionId, buffer);
    }
  }

  @SubscribeMessage('stop_agent_speaking')
  handleManualInterrupt(@ConnectedSocket() client: WebSocket) {
    const sessionId = this.clientSessionMap.get(client);
    if (sessionId) {
      this.voiceAgentService.interruptSession(sessionId);
      this.sendJson(client, {
        event: 'stop_audio',
        data: { reason: 'manual_interrupt' },
      });
    }
  }

  @SubscribeMessage('text_input')
  async handleTextInput(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() payload: { text: string; history?: any[]; cli?: string },
  ) {
    const sessionId = this.clientSessionMap.get(client);
    if (sessionId && payload?.text) {
      const result = await this.voiceAgentService.processTextMessage(
        payload.text,
        payload.history || [],
        payload.cli || '',
      );
      this.sendJson(client, {
        event: 'ai_reply',
        data: result,
      });
    }
  }

  private sendJson(client: WebSocket, data: any) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}
