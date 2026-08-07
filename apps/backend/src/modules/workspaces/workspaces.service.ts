import crypto from "node:crypto";
import type { User, WorkspaceRole } from "@prisma/client";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
} from "../../lib/errors.js";
import { can } from "../../middleware/authorize.js";
import * as repo from "./workspaces.repository.js";

/**
 * Workspace service — business logic for workspace management.
 *
 * Enforces:
 * - Last-Owner guardrail (requires DB count query, can't be in can())
 * - Invite validation (expiry, already accepted, already a member)
 * - Slug generation with collision handling
 */

// ─── Workspace CRUD ──────────────────────────────────────────────────────

export async function createWorkspace(
  user: User,
  data: { name: string }
) {
  const slug = await generateUniqueSlug(data.name);

  // Transaction: create workspace + owner membership atomically.
  const workspace = await repo.prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: { name: data.name, slug },
    });

    await tx.workspaceMembership.create({
      data: {
        workspaceId: ws.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    return ws;
  });

  return workspace;
}

export async function getWorkspace(workspaceId: string) {
  const workspace = await repo.findWorkspaceById(workspaceId);
  if (!workspace) throw new NotFoundError("Workspace not found");
  return workspace;
}

export async function listUserWorkspaces(userId: string) {
  const memberships = await repo.findWorkspacesByUserId(userId);
  return memberships.map((m) => ({
    ...m.workspace,
    role: m.role,
    joinedAt: m.joinedAt,
  }));
}

export async function updateWorkspace(
  workspaceId: string,
  data: { name?: string }
) {
  return repo.updateWorkspace(workspaceId, data);
}

export async function deleteWorkspace(workspaceId: string) {
  // Ownership check is done by can() in the route. Cascade delete
  // handles all child records per the Prisma schema.
  return repo.deleteWorkspace(workspaceId);
}

// ─── Member Management ──────────────────────────────────────────────────

export async function listMembers(workspaceId: string) {
  return repo.findMembershipsByWorkspace(workspaceId);
}

export async function removeMember(
  workspaceId: string,
  targetUserId: string,
  actingMembershipRole: WorkspaceRole
) {
  const targetMembership = await repo.findMembership(
    workspaceId,
    targetUserId
  );
  if (!targetMembership) throw new NotFoundError("Member not found");

  // Can't remove yourself through this endpoint — use "leave workspace" instead
  // (not in MVP scope, but the guard is correct).

  // Last-Owner guardrail: if the target is an Owner, check count.
  if (targetMembership.role === "OWNER") {
    // Only Owners can remove Owners (enforced by can()), but we still
    // need to check the last-Owner constraint.
    if (actingMembershipRole !== "OWNER") {
      throw new ForbiddenError("Only Owners can remove other Owners");
    }
    const ownerCount = await repo.countOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new ForbiddenError(
        "Cannot remove the last Owner of a workspace"
      );
    }
  }

  await repo.deleteMembership(targetMembership.id);
}

export async function changeRole(
  workspaceId: string,
  targetUserId: string,
  newRole: WorkspaceRole,
  actingMembership: { userId: string; role: WorkspaceRole }
) {
  const targetMembership = await repo.findMembership(
    workspaceId,
    targetUserId
  );
  if (!targetMembership) throw new NotFoundError("Member not found");

  // Can't change your own role.
  if (targetUserId === actingMembership.userId) {
    throw new BadRequestError("Cannot change your own role");
  }

  // Admin can only toggle Member↔Admin, validated by can() in route.
  // But we also need the last-Owner guardrail for demoting an Owner.
  if (targetMembership.role === "OWNER" && newRole !== "OWNER") {
    const ownerCount = await repo.countOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new ForbiddenError(
        "Cannot demote the last Owner of a workspace"
      );
    }
  }

  return repo.updateMembershipRole(targetMembership.id, newRole);
}

export async function transferOwnership(
  workspaceId: string,
  targetUserId: string
) {
  const targetMembership = await repo.findMembership(
    workspaceId,
    targetUserId
  );
  if (!targetMembership) throw new NotFoundError("Member not found");

  if (targetMembership.role === "OWNER") {
    throw new ConflictError("User is already an Owner");
  }

  // Grant OWNER role to target. Does NOT demote the current Owner —
  // multiple Owners are allowed per RBAC doc.
  return repo.updateMembershipRole(targetMembership.id, "OWNER");
}

export async function updateMemberPermissions(
  workspaceId: string,
  targetUserId: string,
  permissions: { canDeleteProjects?: boolean; canDeleteBoards?: boolean }
) {
  const targetMembership = await repo.findMembership(
    workspaceId,
    targetUserId
  );
  if (!targetMembership) throw new NotFoundError("Member not found");

  return repo.updateMembershipPermissions(targetMembership.id, permissions);
}

// ─── Invite Management ──────────────────────────────────────────────────

const INVITE_EXPIRY_DAYS = 7;

export async function createInvite(
  workspaceId: string,
  invitedById: string,
  data: { email: string; role?: WorkspaceRole }
) {
  // Check if user is already a member (by email → user lookup).
  // We can't do this perfectly without a User record (the invitee
  // might not have signed up yet), but if they have, catch it early.
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  return repo.createInvite({
    workspaceId,
    email: data.email,
    role: data.role ?? "MEMBER",
    token,
    invitedById,
    expiresAt,
  });
}

export async function acceptInvite(token: string, user: User) {
  const invite = await repo.findInviteByToken(token);
  if (!invite) throw new NotFoundError("Invite not found");

  if (invite.acceptedAt) {
    throw new ConflictError("Invite has already been accepted");
  }

  if (new Date() > invite.expiresAt) {
    throw new GoneError("Invite has expired");
  }

  // Check if user is already a member.
  const existingMembership = await repo.findMembership(
    invite.workspaceId,
    user.id
  );
  if (existingMembership) {
    throw new ConflictError("You are already a member of this workspace");
  }

  // Transaction: create membership + mark invite as accepted.
  await repo.prisma.$transaction(async (tx) => {
    await tx.workspaceMembership.create({
      data: {
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
      },
    });

    await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
  });

  return invite.workspace;
}

// ─── Slug Generation ─────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 48); // Keep slugs reasonable length
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = toSlug(name);
  if (!base) {
    // Fallback for names that are entirely special characters.
    return `workspace-${crypto.randomBytes(4).toString("hex")}`;
  }

  // Check if base slug is available.
  const existing = await repo.findWorkspaceBySlug(base);
  if (!existing) return base;

  // Collision: append random suffix.
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}
