import { PrismaClient } from "../src/generated/prisma/client.js";
import {PrismaPg} from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, });

const prisma = new PrismaClient({ adapter });

/**
 * Fixed, deterministic 30-minute slots, seeded so the API has data to serve
 * without needing any "availability rules" logic. Feel free to re-run;
 * existing slots (by id) are left untouched via upsert.
 */
function buildSlots() {
  const day = '2030-01-15'; // far-future fixed date, deterministic for tests
  const hours = [9, 9.5, 10, 10.5, 11, 13, 13.5, 14];
  return hours.map((h, i) => {
    const startHour = Math.floor(h);
    const startMin = h % 1 === 0 ? 0 : 30;
    const start = new Date(`${day}T${pad(startHour)}:${pad(startMin)}:00.000Z`);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return {
      id: `00000000-0000-4000-8000-00000000000${i}`,
      startsAt: start,
      endsAt: end,
    };
  });
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

async function main() {
  const slots = buildSlots();
  for (const slot of slots) {
    await prisma.slot.upsert({
      where: { id: slot.id },
      update: {},
      create: slot,
    });
  }
  console.log(`Seeded ${slots.length} slots.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
