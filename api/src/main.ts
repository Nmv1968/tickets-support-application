import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
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

  // In the container Node is process 1, and Linux drops a signal sent to process 1 unless the
  // program handles it: without this, `docker stop` waits for its kill timeout on every redeploy.
  process.once('SIGTERM', () => process.exit(0));

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
