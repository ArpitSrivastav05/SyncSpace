import { prisma } from "../../lib/prisma.js";

import type { WorkspaceRole, Prisma } from "@prisma/client";

/**
 * Workspace repository — direct Prisma queries for workspace-level operations.
 *
 * These operate ON the workspace itself (create, read, update, delete workspace),
 * not WITHIN it for tenant-scoped sub-resources. That's why they use the Prisma
 * client directly instead of the scoped repository — the scoped repo is for
 * resources that live inside a workspace (projects, boards, etc.).
 */

export async function createWorkspace(
  data: Prisma.WorkspaceCreateInput
) {
  return prisma.workspace.create({ data });
}

export async function findWorkspaceById(id: string) {
  return prisma.workspace.findUnique({ where: { id } });
}

export async function findWorkspaceBySlug(slug: string) {
  return prisma.workspace.findUnique({ where: { slug } });
}

export async function updateWorkspace(
  id: string,
  data: Prisma.WorkspaceUpdateInput
) {
  return prisma.workspace.update({ where: { id }, data });
}

export async function deleteWorkspace(id: string) {
  return prisma.workspace.delete({ where: { id } });
}

// ─── Membership Queries ──────────────────────────────────────────────────

export async function findMembershipsByWorkspace(workspaceId: string) {
  return prisma.workspaceMembership.findMany({
    where: { workspaceId },
    include: { user: true },
    orderBy: { joinedAt: "asc" },
  });
}

export async function findMembership(workspaceId: string, userId: string) {
  return prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

export async function createMembership(data: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}) {
  return prisma.workspaceMembership.create({ data });
}

export async function updateMembershipRole(
  membershipId: string,
  role: WorkspaceRole
) {
  return prisma.workspaceMembership.update({
    where: { id: membershipId },
    data: { role },
  });
}

export async function updateMembershipPermissions(
  membershipId: string,
  data: { canDeleteProjects?: boolean; canDeleteBoards?: boolean }
) {
  return prisma.workspaceMembership.update({
    where: { id: membershipId },
    data,
  });
}

export async function deleteMembership(membershipId: string) {
  return prisma.workspaceMembership.delete({ where: { id: membershipId } });
}

export async function countOwners(workspaceId: string): Promise<number> {
  return prisma.workspaceMembership.count({
    where: { workspaceId, role: "OWNER" },
  });
}

export async function findWorkspacesByUserId(userId: string) {
  return prisma.workspaceMembership.findMany({
    where: { userId },
    include: { workspace: true },
  });
}

// ─── Invite Queries ──────────────────────────────────────────────────────

export async function createInvite(data: Prisma.WorkspaceInviteUncheckedCreateInput) {
  return prisma.workspaceInvite.create({ data });
}

export async function findInviteByToken(token: string) {
  return prisma.workspaceInvite.findUnique({
    where: { token },
    include: { workspace: true },
  });
}

export async function markInviteAccepted(id: string) {
  return prisma.workspaceInvite.update({
    where: { id },
    data: { acceptedAt: new Date() },
  });
}

// ─── Transaction Helper ──────────────────────────────────────────────────

export { prisma };
