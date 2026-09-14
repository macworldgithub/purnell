import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express, Request, Response } from 'express';
import { AppModule } from '../src/app.module';

const server: Express = express();
let isReady = false;

async function bootstrap(): Promise<Express> {
  if (!isReady) {
    const app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(server),
    );
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
