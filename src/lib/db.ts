import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertInstanceDatabase } from './instance';
assertInstanceDatabase(process.env.DATABASE_URL);
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000,
    }),
  });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
