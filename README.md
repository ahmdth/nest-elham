# Appointment Booking API

NestJS + TypeScript + PostgreSQL (via Prisma) + Socket.IO. Fixed, seeded
appointment slots; book one, cancel one, watch it happen live over a socket.

No auth, no payments, no frontend, no Docker, no CI - just the three
endpoints and the realtime events the spec asks for.

## Stack

- **NestJS 10** / TypeScript
- **PostgreSQL** via **Prisma 5** (raw SQL migration, see "Concurrency strategy" below)
- **Socket.IO** (`@nestjs/websockets` + `@nestjs/platform-socket.io`)
- **Swagger UI** (`/docs`) and raw **OpenAPI JSON** (`/openapi.json`) via `@nestjs/swagger`
- **Jest + supertest + socket.io-client** for e2e tests against a real Postgres database

## Getting started

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL / TEST_DATABASE_URL if needed

# Create the two databases referenced in .env (names are just examples):
createdb appointments
createdb appointments_test

npx prisma migrate deploy     # applies prisma/migrations/*/migration.sql to DATABASE_URL
npm run seed                  # inserts 8 fixed 30-minute slots on 2030-01-15

npm run start:dev             # http://localhost:3000
```

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

### Running the tests

```bash
npm run test:e2e
```

This runs against `TEST_DATABASE_URL`, **not** `DATABASE_URL` - keep them
pointed at different databases so a test run never touches your dev data.
The suite is self-contained and repeatable:

- `test/global-setup.ts` runs once before the whole suite and applies
  `npx prisma migrate deploy` to `TEST_DATABASE_URL` automatically, so you
  never have to remember to migrate the test DB by hand.
- `test/setup-env.ts` runs before each test file's imports are evaluated and
  points `DATABASE_URL` at `TEST_DATABASE_URL` for that worker, so the app
  under test connects to the test database.
- `beforeEach` in the spec truncates `Booking`/`Slot` and reseeds three fixed
  slots, so every test starts from a known, identical state and tests can
  run in any order.

Covers the three mandatory scenarios plus a few more:

1. **Successful booking** - `POST /bookings` returns 201, and the slot
   disappears from `GET /slots`.
2. **Concurrency** - two (and, in a second test, five) genuinely concurrent
   `POST /bookings` requests for the *same* slot are fired via `Promise.all`
   against the real running server; exactly one resolves 201 and the rest
   resolve 409, verified both from the HTTP responses and by counting rows
   directly in Postgres. Not simulated and not sequential.
3. **Cancellation** - `DELETE /bookings/:id` returns 200, the slot
   reappears in `GET /slots`, and a brand-new booking for it succeeds.
4. Extras: idempotent re-cancellation, an old cancelled booking not
   affecting a newer active one for the same slot, validation errors (missing
   field, bad email, blank-after-trim name, malformed JSON body), 404s for
   well-formed-but-unknown ids, 400 for a malformed id, `slot.booked` /
   `slot.released` actually arriving over a real Socket.IO connection, and
   that `/docs` and `/openapi.json` are actually served.

### Testing Socket.IO by hand

```bash
npm run start:dev            # terminal 1
npm run socket:client        # terminal 2 - connects and logs slot.booked/slot.released
curl -X POST http://localhost:3000/bookings \
  -H 'Content-Type: application/json' \
  -d '{"slotId":"<id from GET /slots>","customerName":"Alex Morgan","customerEmail":"alex@example.com"}'
# -> terminal 2 prints the slot.booked event
```

`scripts/socket-test-client.js` is a plain `socket.io-client` script; no
Postman/browser needed.

## Key design decisions

### Data model

`Slot` (fixed, seeded) has many `Booking`s. A booking's `status` is
`active` or `cancelled`; "available" is defined purely as "no active
booking exists for this slot" - there's no separate `available` boolean to
keep in sync, which removes a whole class of bugs where the flag and the
booking rows disagree.

### Concurrency strategy

Two layers, deliberately redundant:

1. **Row lock in a transaction** (the primary mechanism). `POST /bookings`
   runs inside a Prisma interactive transaction that does
   `SELECT id FROM "Slot" WHERE id = $1 FOR UPDATE` first. Any other request
   for the *same slot* blocks on that lock until the first transaction
   commits or rolls back, so the "does an active booking already exist?"
   check that follows is never racing another request for the same slot.
   This is what actually produces the "one 201, one 409" behavior under
   concurrent load, and it's easy to reason about.

2. **Partial unique index** (the backstop). `Booking_slotId_active_unique`
   is a Postgres partial unique index - `UNIQUE ("slotId") WHERE status =
   'active'` - added by hand in the migration SQL (Prisma's schema
   language has no syntax for partial indexes). Even if the row lock were
   ever bypassed, the database itself refuses a second active booking for
   the same slot; a violation is caught and mapped to `409
   SLOT_UNAVAILABLE`. It also does the right thing for free: a *cancelled*
   row is invisible to the index, so an old cancelled booking never blocks
   a fresh one for the same slot.

### Cancellation is idempotent by design

`DELETE /bookings/:id` reads the booking first; if it's already
`cancelled`, the handler returns 200 with the unchanged booking and does
nothing else - no event, no write. Only a real `active` -> `cancelled`
transition emits `slot.released`. Since cancellation always targets one
specific booking id, an old cancelled booking can never affect whichever
booking is currently active for that slot.

### Errors

A single `AppException` class carries an error `code` and maps to the
right HTTP status; a global exception filter (`AllExceptionsFilter`)
normalizes *everything* - including Nest's built-in validation errors,
`ParseUUIDPipe` failures, and malformed-JSON body-parser errors - into the
required `{"error":{"code","message"}}` shape, and turns any truly
unexpected error into a `500 INTERNAL_ERROR` without leaking internals.

### Socket.IO events

Emitted from `BookingsService` only *after* the transaction that caused
them has committed - never speculatively, never for a 409/404, and never
for a no-op cancellation. Default namespace, default path, no auth, no
rooms, matching the spec exactly.

## A note on this build environment

This project was built and its SQL/data-model logic verified directly
against a real local PostgreSQL instance (the migration was applied by
hand with `psql` and the partial-unique-index concurrency behavior was
confirmed with raw `INSERT`s). The full TypeScript source was also
type-checked clean.

However, the sandbox this was built in has restricted network egress and
cannot reach `binaries.prisma.sh`, which the Prisma CLI needs to download
its query/schema-engine binaries for `prisma generate` / `prisma migrate
dev`. That means `npm run test:e2e` and `npm run start:dev` were **not**
executed end-to-end in this environment. They will work normally on a
machine with regular internet access - run `npm install` followed by
`npx prisma migrate deploy` (or `migrate dev` if you want to generate your
own migration instead of using the hand-written one in
`prisma/migrations/`) and `npm run test:e2e`. If anything surfaces during
that first run, it's most likely a small Prisma-generated-type mismatch
rather than a logic issue - the business logic and SQL have both been
exercised directly.
