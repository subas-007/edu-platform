import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env, isProduction } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: isProduction ? ['log', 'warn', 'error'] : undefined,
  });

  app.set('trust proxy', 1); // behind the Next.js proxy / load balancer — needed for per-IP rate limits
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '256kb' });
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  Logger.log(`API listening on :${env.PORT}`, 'Bootstrap');
}

void bootstrap();
