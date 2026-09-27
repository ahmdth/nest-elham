// Runs once per test worker, BEFORE the test framework and BEFORE the spec
// file's own imports are evaluated (Jest's `setupFiles` phase). This is what
// makes it safe to import PrismaClient/the Nest app later in the spec file
// and have it connect to the *test* database rather than the dev one.
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy .env.example to .env and set ' +
      'TEST_DATABASE_URL to a Postgres database dedicated to tests ' +
      '(different from DATABASE_URL).',
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
