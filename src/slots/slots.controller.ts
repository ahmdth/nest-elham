import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SlotsService } from './slots.service.js';

@ApiTags('slots')
@Controller('slots')
export class SlotsController {
  constructor(private readonly slotsService: SlotsService) {}

  @Get()
  @ApiOperation({
    summary: 'List available appointment slots',
    description:
      'Returns only slots that currently have no active booking, sorted ' +
      'ascending by startsAt then id. Returns { "slots": [] } if none are available.',
  })
  @ApiOkResponse({
    description: 'Available slots',
    schema: {
      example: {
        slots: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            startsAt: '2030-01-15T09:00:00.000Z',
            endsAt: '2030-01-15T09:30:00.000Z',
          },
        ],
      },
    },
  })
  async getSlots() {
    const slots = await this.slotsService.findAvailable();
    return { slots };
  }
}
