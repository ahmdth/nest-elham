import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SlotView {
  id: string;
  startsAt: string;
  endsAt: string;
}

@Injectable()
export class SlotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A slot is "available" if it has no booking whose status is 'active'.
   * Sorted ascending by startsAt, then id, per the spec.
   */
  async findAvailable(): Promise<SlotView[]> {
    const slots = await this.prisma.slot.findMany({
      where: {
        bookings: {
          none: { status: 'active' },
        },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    return slots.map((slot) => ({
      id: slot.id,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
    }));
  }
}
