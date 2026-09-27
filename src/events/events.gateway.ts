import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface SlotBookedPayload {
  slotId: string;
  bookingId: string;
  available: false;
}

export interface SlotReleasedPayload {
  slotId: string;
  bookingId: string;
  available: true;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitSlotBooked(payload: SlotBookedPayload) {
    this.server.emit('slot.booked', payload);
  }

  emitSlotReleased(payload: SlotReleasedPayload) {
    this.server.emit('slot.released', payload);
  }
}
