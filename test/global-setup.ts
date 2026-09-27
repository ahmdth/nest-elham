import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

/**
 * Runs once for the entire test:e2e run, in its own process, before any
 * test file/worker starts. Applies all Prisma migrations to
 * TEST_DATABASE_URL so the suite never depends on a developer having run
 * migrations by hand, and is safe to re-run (migrate deploy is idempotent).
 */
export default async function globalSetup() {
  dotenv.config();

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env first.',
    );
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
