import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { BookingsService } from './bookings.service.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a booking for a slot',
    description:
      'All fields are mandatory. customerName/customerEmail are trimmed ' +
      'before validation. Fails with 404 SLOT_NOT_FOUND if the slot does ' +
      'not exist, or 409 SLOT_UNAVAILABLE if it already has an active booking.',
  })
  @ApiCreatedResponse({
    description: 'Booking created',
    schema: {
      example: {
        booking: {
          id: '22222222-2222-4222-8222-222222222222',
          slotId: '11111111-1111-4111-8111-111111111111',
          customerName: 'Alex Morgan',
          customerEmail: 'alex@example.com',
          status: 'active',
        },
      },
    },
  })
  async create(@Body() dto: CreateBookingDto) {
    const booking = await this.bookingsService.create(dto);
    return { booking };
  }

  @Delete(':bookingId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiOperation({
    summary: 'Cancel a booking',
    description:
      'Sets status to cancelled and frees the slot. Cancelling an ' +
      'already-cancelled booking is a no-op that still returns 200.',
  })
  @ApiOkResponse({
    description: 'Booking cancelled (or already cancelled)',
    schema: {
      example: {
        booking: {
          id: '22222222-2222-4222-8222-222222222222',
          slotId: '11111111-1111-4111-8111-111111111111',
          customerName: 'Alex Morgan',
          customerEmail: 'alex@example.com',
          status: 'cancelled',
        },
      },
    },
  })
  async cancel(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' }))
    bookingId: string,
  ) {
    const booking = await this.bookingsService.cancel(bookingId);
    return { booking };
  }
}
