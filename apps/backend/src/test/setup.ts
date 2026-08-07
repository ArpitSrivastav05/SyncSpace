import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

/**
 * Test setup — runs before the test suite to prepare the test database.
 *
 * Uses the DATABASE_URL from the test environment (pointing to syncspace_test)
 * and applies all Prisma migrations so the schema is up-to-date.
 */

const TEST_DATABASE_URL =
  process.env["DATABASE_URL"]?.replace(/\/[^/]*$/, "/syncspace_test") ??
  "postgresql://syncspace:syncspace_dev@localhost:5432/syncspace_test";

// Override DATABASE_URL for the test process.
process.env["DATABASE_URL"] = TEST_DATABASE_URL;

const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

/**
 * Apply migrations to the test database.
 * Uses `prisma migrate deploy` (not `dev`) since we don't want
 * interactive prompts in CI.
 */
export async function setupTestDatabase(): Promise<void> {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}

/**
 * Clean all data from the test database between test runs.
 * Truncates all tables in reverse-dependency order to avoid FK violations.
 */
export async function cleanDatabase(): Promise<void> {
  // Truncate in reverse-dependency order.
  // Using $executeRawUnsafe for TRUNCATE CASCADE.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "Notification", "Message", "DocumentUpdate", "Document",
    "Task", "BoardColumn", "Board", "Channel", "Project",
    "WorkspaceInvite", "WorkspaceMembership", "Workspace", "User"
    CASCADE
  `);
}

export async function disconnectTestDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { prisma as testPrisma, TEST_DATABASE_URL };
