import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('Appointment Booking API')
    .setDescription(
      'Slots, bookings and cancellations for a fixed-slot appointment system. ' +
        'No authentication is required for any endpoint. See the README for ' +
        'Socket.IO event documentation (slot.booked / slot.released), which ' +
        'is not part of this HTTP spec.',
    )
    .setVersion('1.0.0')
    .addTag('slots')
    .addTag('bookings')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  // Serve the raw OpenAPI JSON at the exact path required by the spec.
  app.getHttpAdapter().get('/openapi.json', (_req, res) => res.json(document));

  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Appointment API listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger UI:   http://localhost:${port}/docs`);
  // eslint-disable-next-line no-console
  console.log(`OpenAPI JSON: http://localhost:${port}/openapi.json`);
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Error starting application:', err);
  process.exit(1);
});