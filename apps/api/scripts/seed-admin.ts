// Bootstraps the first administrator. There is no public sign-up: all other
// accounts are provisioned by an admin through POST /api/v1/users.
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

async function seedAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 14) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 14 chars).');
  }
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, role: UserRole.ADMIN },
    });
    console.log(`Admin ready: ${email}. Remove SEED_ADMIN_PASSWORD from .env now.`);
  } finally {
    await prisma.$disconnect();
  }
}

seedAdmin().catch((error) => {
  console.error(error);
  process.exit(1);
});
