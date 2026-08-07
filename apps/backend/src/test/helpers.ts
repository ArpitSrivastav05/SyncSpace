import { testPrisma } from "./setup.js";
import crypto from "node:crypto";

import type { WorkspaceRole } from "@prisma/client";

/**
 * Test factories — helpers for creating test entities.
 *
 * These create real database records (not mocks) for integration tests.
 * Each factory returns the created record.
 */

let counter = 0;

function uniqueId(): string {
  counter++;
  return `test-${counter}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function createTestUser(overrides: {
  id?: string;
  email?: string;
  name?: string;
} = {}) {
  const id = overrides.id ?? uniqueId();
  return testPrisma.user.create({
    data: {
      id,
      email: overrides.email ?? `${id}@test.syncspace.dev`,
      name: overrides.name ?? `Test User ${id}`,
    },
  });
}

export async function createTestWorkspace(overrides: {
  name?: string;
  slug?: string;
} = {}) {
  const slug = overrides.slug ?? uniqueId();
  return testPrisma.workspace.create({
    data: {
      name: overrides.name ?? `Test Workspace ${slug}`,
      slug,
    },
  });
}

export async function createTestMembership(data: {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole;
  canDeleteProjects?: boolean;
  canDeleteBoards?: boolean;
}) {
  return testPrisma.workspaceMembership.create({
    data: {
      workspaceId: data.workspaceId,
      userId: data.userId,
      role: data.role ?? "MEMBER",
      canDeleteProjects: data.canDeleteProjects ?? false,
      canDeleteBoards: data.canDeleteBoards ?? false,
    },
  });
}

export async function createTestProject(data: {
  workspaceId: string;
  createdById: string;
  name?: string;
}) {
  return testPrisma.project.create({
    data: {
      workspaceId: data.workspaceId,
      name: data.name ?? `Test Project ${uniqueId()}`,
      createdById: data.createdById,
    },
  });
}

export async function createTestInvite(data: {
  workspaceId: string;
  invitedById: string;
  email?: string;
  role?: WorkspaceRole;
  token?: string;
  expiresAt?: Date;
}) {
  const expiresAt = data.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return testPrisma.workspaceInvite.create({
    data: {
      workspaceId: data.workspaceId,
      email: data.email ?? `invite-${uniqueId()}@test.syncspace.dev`,
      role: data.role ?? "MEMBER",
      token: data.token ?? crypto.randomBytes(32).toString("hex"),
      invitedById: data.invitedById,
      expiresAt,
    },
  });
}
