import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createApp } from '../src/main.js';

// Fixed test slot ids/times - recreated fresh before every test.
const SLOT_A = '10000000-0000-4000-8000-000000000001';
const SLOT_B = '10000000-0000-4000-8000-000000000002';
const SLOT_C = '10000000-0000-4000-8000-000000000003';

function isoSlot(hour: number) {
  const start = new Date(Date.UTC(2031, 0, 10, hour, 0, 0, 0));
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { startsAt: start, endsAt: end };
}

describe('Appointment API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let adapter: any;
  let prisma: PrismaClient;

  beforeAll(async () => {
    adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean slate for every test: bookings first (FK), then slots.
    await prisma.booking.deleteMany({});
    await prisma.slot.deleteMany({});

    await prisma.slot.createMany({
      data: [
        { id: SLOT_A, ...isoSlot(9) },
        { id: SLOT_B, ...isoSlot(10) },
        { id: SLOT_C, ...isoSlot(11) },
      ],
    });
  });

  // 1. GET /slots
  describe('GET /slots', () => {
    it('returns all seeded slots sorted by startsAt', async () => {
      const res = await request(baseUrl).get('/slots').expect(200);
      expect(res.body.slots.map((s: any) => s.id)).toEqual([
        SLOT_A,
        SLOT_B,
        SLOT_C,
      ]);
      expect(res.body.slots[0]).toEqual({
        id: SLOT_A,
        startsAt: isoSlot(9).startsAt.toISOString(),
        endsAt: isoSlot(9).endsAt.toISOString(),
      });
    });

    it('returns { slots: [] } when nothing is available', async () => {
      await prisma.slot.deleteMany({});
      const res = await request(baseUrl).get('/slots').expect(200);
      expect(res.body).toEqual({ slots: [] });
    });
  });

  // 2. Successful booking + slot disappears
  describe('POST /bookings - success path', () => {
    it('creates a booking (201) and removes the slot from GET /slots', async () => {
      const res = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: '  Alex Morgan  ',
          customerEmail: '  alex@example.com  ',
        })
        .expect(201);

      expect(res.body.booking).toMatchObject({
        slotId: SLOT_A,
        customerName: 'Alex Morgan', // trimmed
        customerEmail: 'alex@example.com', // trimmed
        status: 'active',
      });
      expect(typeof res.body.booking.id).toBe('string');

      const slotsRes = await request(baseUrl).get('/slots').expect(200);
      const ids = slotsRes.body.slots.map((s: any) => s.id);
      expect(ids).not.toContain(SLOT_A);
      expect(ids).toEqual([SLOT_B, SLOT_C]);
    });

    it('emits slot.booked over Socket.IO after commit', async () => {
      const socket = io(baseUrl, { path: '/socket.io' });
      await waitForConnect(socket);

      const eventPromise = waitForEvent(socket, 'slot.booked');

      const res = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_B,
          customerName: 'Sam',
          customerEmail: 'sam@example.com',
        })
        .expect(201);

      const payload = await eventPromise;
      expect(payload).toEqual({
        slotId: SLOT_B,
        bookingId: res.body.booking.id,
        available: false,
      });

      socket.close();
    });
  });

  // 3. Concurrency: two overlapping requests for the same slot
  describe('POST /bookings - concurrency', () => {
    it('only lets ONE of two truly concurrent requests for the same slot win', async () => {
      const payloadA = {
        slotId: SLOT_A,
        customerName: 'Racer One',
        customerEmail: 'one@example.com',
      };
      const payloadB = {
        slotId: SLOT_A,
        customerName: 'Racer Two',
        customerEmail: 'two@example.com',
      };

      // Fired in parallel - both hit the server before either resolves.
      const [resA, resB] = await Promise.all([
        request(baseUrl).post('/bookings').send(payloadA),
        request(baseUrl).post('/bookings').send(payloadB),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const winner = resA.status === 201 ? resA : resB;
      const loser = resA.status === 201 ? resB : resA;
      expect(winner.body.booking.status).toBe('active');
      expect(loser.body.error.code).toBe('SLOT_UNAVAILABLE');

      const activeBookings = await prisma.booking.findMany({
        where: { slotId: SLOT_A, status: 'active' },
      });
      expect(activeBookings).toHaveLength(1);

      const allBookingsForSlot = await prisma.booking.findMany({
        where: { slotId: SLOT_A },
      });
      expect(allBookingsForSlot).toHaveLength(1);
    });

    it('a burst of 5 concurrent requests for the same slot yields exactly one winner', async () => {
      const requests = Array.from({ length: 5 }).map((_, i) =>
        request(baseUrl)
          .post('/bookings')
          .send({
            slotId: SLOT_C,
            customerName: `Racer ${i}`,
            customerEmail: `racer${i}@example.com`,
          }),
      );

      const results = await Promise.all(requests);
      const created = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);

      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(4);

      const activeBookings = await prisma.booking.findMany({
        where: { slotId: SLOT_C, status: 'active' },
      });
      expect(activeBookings).toHaveLength(1);
    });
  });

  // 4. Cancellation frees the slot for a new booking
  describe('DELETE /bookings/:id', () => {
    it('cancels (200), frees the slot, and allows a new booking', async () => {
      const createRes = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: 'First Customer',
          customerEmail: 'first@example.com',
        })
        .expect(201);

      const bookingId = createRes.body.booking.id;

      // Slot is gone while active.
      let slots = await request(baseUrl).get('/slots');
      expect(slots.body.slots.map((s: any) => s.id)).not.toContain(SLOT_A);

      const cancelRes = await request(baseUrl)
        .delete(`/bookings/${bookingId}`)
        .expect(200);
      expect(cancelRes.body.booking).toMatchObject({
        id: bookingId,
        status: 'cancelled',
      });

      // Slot is available again.
      slots = await request(baseUrl).get('/slots');
      expect(slots.body.slots.map((s: any) => s.id)).toContain(SLOT_A);

      // A brand-new booking for the same slot now succeeds.
      const secondRes = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: 'Second Customer',
          customerEmail: 'second@example.com',
        })
        .expect(201);
      expect(secondRes.body.booking.status).toBe('active');
    });

    it('emits slot.released over Socket.IO after a real cancellation', async () => {
      const createRes = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: 'A',
          customerEmail: 'a@example.com',
        })
        .expect(201);
      const bookingId = createRes.body.booking.id;

      const socket = io(baseUrl, { path: '/socket.io' });
      await waitForConnect(socket);
      const eventPromise = waitForEvent(socket, 'slot.released');

      await request(baseUrl).delete(`/bookings/${bookingId}`).expect(200);

      const payload = await eventPromise;
      expect(payload).toEqual({ slotId: SLOT_A, bookingId, available: true });

      socket.close();
    });

    it('repeated cancellation of an already-cancelled booking is a 200 no-op', async () => {
      const createRes = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: 'A',
          customerEmail: 'a@example.com',
        })
        .expect(201);
      const bookingId = createRes.body.booking.id;

      await request(baseUrl).delete(`/bookings/${bookingId}`).expect(200);
      const secondCancel = await request(baseUrl)
        .delete(`/bookings/${bookingId}`)
        .expect(200);

      expect(secondCancel.body.booking.status).toBe('cancelled');

      // No duplicate rows, no side effects.
      const rows = await prisma.booking.findMany({ where: { id: bookingId } });
      expect(rows).toHaveLength(1);
    });

    it('cancelling an old cancelled booking does not affect a newer active one for the same slot', async () => {
      const first = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: 'A',
          customerEmail: 'a@example.com',
        })
        .expect(201);
      await request(baseUrl)
        .delete(`/bookings/${first.body.booking.id}`)
        .expect(200);

      const second = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: 'B',
          customerEmail: 'b@example.com',
        })
        .expect(201);

      // Re-cancel the OLD booking again.
      await request(baseUrl)
        .delete(`/bookings/${first.body.booking.id}`)
        .expect(200);

      const secondBooking = await prisma.booking.findUnique({
        where: { id: second.body.booking.id },
      });
      expect(secondBooking?.status).toBe('active');
    });

    it('404s with BOOKING_NOT_FOUND for a well-formed but unknown id', async () => {
      const res = await request(baseUrl)
        .delete('/bookings/99999999-9999-4999-8999-999999999999')
        .expect(404);
      expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    });

    it('400s with VALIDATION_ERROR for a malformed id', async () => {
      const res = await request(baseUrl)
        .delete('/bookings/not-a-uuid')
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // --- 5. Validation & not-found errors on create -------------------------

  describe('POST /bookings - validation', () => {
    it('400s when a required field is missing', async () => {
      const res = await request(baseUrl)
        .post('/bookings')
        .send({ slotId: SLOT_A, customerEmail: 'a@example.com' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('400s for an invalid email', async () => {
      const res = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: 'A',
          customerEmail: 'not-an-email',
        })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('400s for a blank name after trimming', async () => {
      const res = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: SLOT_A,
          customerName: '   ',
          customerEmail: 'a@example.com',
        })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('400s for malformed JSON body', async () => {
      const res = await request(baseUrl)
        .post('/bookings')
        .set('Content-Type', 'application/json')
        .send('{"slotId": "not valid json' as any)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('404s with SLOT_NOT_FOUND for a well-formed but unknown slot id', async () => {
      const res = await request(baseUrl)
        .post('/bookings')
        .send({
          slotId: '99999999-9999-4999-8999-999999999999',
          customerName: 'A',
          customerEmail: 'a@example.com',
        })
        .expect(404);
      expect(res.body.error.code).toBe('SLOT_NOT_FOUND');
    });
  });

  // --- 6. OpenAPI docs are actually served --------------------------------

  describe('Docs', () => {
    it('serves /openapi.json', async () => {
      const res = await request(baseUrl).get('/openapi.json').expect(200);
      expect(res.body.paths['/slots']).toBeDefined();
      expect(res.body.paths['/bookings']).toBeDefined();
      expect(res.body.paths['/bookings/{bookingId}']).toBeDefined();
    });

    it('serves the Swagger UI at /docs', async () => {
      const res = await request(baseUrl).get('/docs').expect(200);
      expect(res.text).toContain('swagger');
    });
  });
});

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
}

function waitForEvent(socket: Socket, event: string): Promise<any> {
  return new Promise((resolve) => {
    socket.once(event, (payload) => resolve(payload));
  });
}
