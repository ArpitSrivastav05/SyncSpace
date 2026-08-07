import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * In development, we attach the client to `globalThis` to survive
 * hot-reloads without exhausting database connections.
 * In production, a single instance per process is sufficient.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env["NODE_ENV"] === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}
