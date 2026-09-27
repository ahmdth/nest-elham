import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsGateway } from '../events/events.gateway.js';
import { AppException } from '../common/exceptions/app.exception.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { Booking, Prisma } from '../generated/prisma/client.js';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  async create(dto: CreateBookingDto): Promise<Booking> {
    let booking: Booking;

    try {
      booking = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Slot" WHERE "id" = ${dto.slotId}::uuid FOR UPDATE
        `;

        if (locked.length === 0) {
          throw AppException.slotNotFound();
        }

        const existingActive = await tx.booking.findFirst({
          where: { slotId: dto.slotId, status: 'active' },
          select: { id: true },
        });

        if (existingActive) {
          throw AppException.slotUnavailable();
        }

        return tx.booking.create({
          data: {
            slotId: dto.slotId,
            customerName: dto.customerName,
            customerEmail: dto.customerEmail,
            status: 'active',
          },
        });
      });
    } catch (err) {
      if (err instanceof AppException) throw err;
      if (isUniqueConstraintViolation(err)) {
        throw AppException.slotUnavailable();
      }
      this.logger.error('Failed to create booking', err as Error);
      throw AppException.internal();
    }
    this.events.emitSlotBooked({
      slotId: booking.slotId,
      bookingId: booking.id,
      available: false,
    });

    return booking;
  }

  async cancel(bookingId: string): Promise<Booking> {
    let result: { booking: Booking; changed: boolean };

    try {
      result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.booking.findUnique({
          where: { id: bookingId },
        });

        if (!existing) {
          throw AppException.bookingNotFound();
        }

        // Idempotent: cancelling an already-cancelled booking is a 200 no-op.
        if (existing.status === 'cancelled') {
          return { booking: existing, changed: false };
        }

        const updated = await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'cancelled' },
        });

        return { booking: updated, changed: true };
      });
    } catch (err) {
      if (err instanceof AppException) throw err;
      this.logger.error('Failed to cancel booking', err as Error);
      throw AppException.internal();
    }

    // No event for a redundant cancellation of an already-cancelled booking.
    if (result.changed) {
      this.events.emitSlotReleased({
        slotId: result.booking.slotId,
        bookingId: result.booking.id,
        available: true,
      });
    }

    return result.booking;
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
