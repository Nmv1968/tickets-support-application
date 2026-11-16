import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { closeOnStopSignals, configureApp } from './app.setup';
import { checkEnv } from './common/env-check';

async function bootstrap(): Promise<void> {
  // The .env files are read by ConfigModule.forRoot, which importing AppModule started.
  await ConfigModule.envVariablesLoaded;
  const logger = new Logger('Bootstrap');
  const { errors, warnings } = checkEnv(process.env);
  warnings.forEach((message) => logger.warn(message));
  if (errors.length) {
    errors.forEach((message) => logger.error(message));
    logger.error('La API no se inició. Corrige la configuración y vuelve a iniciarla.');
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // Before it starts: a `docker stop` while it connects to the database closes it too.
  closeOnStopSignals(app);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
