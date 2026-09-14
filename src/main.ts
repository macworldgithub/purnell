import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Serve static assets from public folder for the frontend UI
  app.useStaticAssets(join(process.cwd(), 'public'));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Purnell Motors Voice Agent backend listening on port ${port}`);
  console.log(`Frontend UI accessible at: http://localhost:${port}`);
}
bootstrap().catch((err) => {
  console.error('Bootstrap error:', err);
});

