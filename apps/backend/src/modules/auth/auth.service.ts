import { createClerkClient } from "@clerk/express";
import { prisma } from "../../lib/prisma.js";

import type { User } from "@prisma/client";

/**
 * Auth service — domain-level Clerk isolation.
 *
 * Architecture reference: ADR-001 §Authentication
 * "All Clerk SDK calls isolated behind a single internal auth service
 * module — no direct Clerk imports in route handlers — to bound the
 * blast radius of any future migration."
 *
 * This file is one of exactly TWO files that import from @clerk/express.
 * The other is authenticate.ts (the session-verification middleware).
 * See implementation_plan.md §4 for the rationale behind this split.
 *
 * If Clerk is ever replaced, the migration surface is these two files.
 */

const clerkClient = createClerkClient({
  secretKey: process.env["CLERK_SECRET_KEY"],
});

/**
 * Looks up our local User table by Clerk user ID.
 * On first login (user doesn't exist locally yet), syncs name/email
 * from Clerk's user object and creates the local record.
 *
 * This ensures our User table is always the source of truth for
 * domain data, with Clerk only handling authentication.
 */
export async function findOrCreateUser(clerkUserId: string): Promise<User> {
  // Fast path: user already exists locally.
  const existing = await prisma.user.findUnique({
    where: { id: clerkUserId },
  });
  if (existing) return existing;

  // First login: fetch profile from Clerk and create local record.
  const clerkUser = await clerkClient.users.getUser(clerkUserId);

  const email =
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

  if (!email) {
    throw new Error(
      `Clerk user ${clerkUserId} has no email address — cannot create local User record`
    );
  }

  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    email.split("@")[0] ||
    "Unknown";

  return prisma.user.create({
    data: {
      id: clerkUserId,
      email,
      name,
      avatarUrl: clerkUser.imageUrl ?? null,
    },
  });
}

/**
 * Thin wrapper around Clerk's user lookup.
 * Kept here so no other module needs to import @clerk/express directly.
 */
export async function getClerkUser(clerkUserId: string) {
  return clerkClient.users.getUser(clerkUserId);
}
