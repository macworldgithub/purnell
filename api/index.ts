import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import express, { Express, Request, Response } from 'express';
import { AppModule } from '../src/app.module';

const server: Express = express();
let isReady = false;

// Middleware to normalize URL when rewritten by Vercel serverless proxy
server.use((req, res, next) => {
  const originalUrl =
    (req.headers['x-forwarded-uri'] as string) ||
    (req.headers['x-vercel-matched-path'] as string);
  if (
    originalUrl &&
    (req.url === '/api' ||
      req.url === '/api/index.ts' ||
      req.url.startsWith('/api?'))
  ) {
    req.url = originalUrl;
  }
  next();
});

async function bootstrap(): Promise<Express> {
  if (!isReady) {
    const app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(server),
    );
    // Explicitly use WsAdapter so NestJS doesn't fail trying to require platform-socket.io
    app.useWebSocketAdapter(new WsAdapter(app));
    app.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });
    await app.init();
    isReady = true;
  }
  return server;
}

export default async function handler(req: Request, res: Response) {
  await bootstrap();
  server(req, res);
}
