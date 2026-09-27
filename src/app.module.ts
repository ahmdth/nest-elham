import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { SlotsModule } from './slots/slots.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { EventsModule } from './events/events.module.js';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, SlotsModule, BookingsModule, EventsModule],
})
export class AppModule {}
