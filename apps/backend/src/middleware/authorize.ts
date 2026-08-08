import type { WorkspaceMembership, WorkspaceRole } from "@prisma/client";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../lib/errors.js";

/**
 * Authorization helper — `can(action, context)`.
 *
 * Architecture reference: RBAC doc §Enforcement Pattern
 * "Every mutating action passes through a permission-check helper:
 * can(user, action, resource) — a single source of truth for this matrix,
 * not duplicated if/else logic per route."
 *
 * This matrix IS the spec for the test suite — each row of the RBAC
 * permission matrix becomes a test case, so the matrix and the code
 * can't silently drift apart.
 *
 * Note: the last-Owner guardrail is NOT in can() — it requires a DB
 * count query, so it lives in workspaces.service.ts. can() stays a
 * pure, synchronous, trivially-testable function.
 */

// ─── Action Type ────────────────────────────────────────────────────────
// Every row of the RBAC permission matrix maps to one of these actions.

export type Action =
  // Workspace actions
  | "workspace:view_settings"
  | "workspace:update_settings"
  | "workspace:delete"
  // Member actions
  | "member:view"
  | "member:invite"
  | "member:remove"
  | "member:change_role"
  | "member:transfer_ownership"
  | "member:grant_delete_permission"
  // Project actions
  | "project:create"
  | "project:view"
  | "project:update"
  | "project:delete"
  // Board actions
  | "board:create"
  | "board:view"
  | "board:delete"
  // Task actions
  | "task:create"
  | "task:edit"
  | "task:assign"
  // Document actions
  | "document:create"
  | "document:edit"
  | "document:view_history"
  | "document:delete"
  // Channel actions
  | "channel:create"
  | "channel:delete"
  // Message actions
  | "message:post"
  | "message:edit_own"
  | "message:delete_own"
  | "message:moderate"
  // AI actions
  | "ai:use";

// ─── Authorization Context ──────────────────────────────────────────────

export interface AuthorizationContext {
  /** The acting user's membership in the current workspace. */
  membership: Pick<
    WorkspaceMembership,
    "userId" | "role" | "canDeleteProjects" | "canDeleteBoards"
  >;
  /** Optional context about the specific resource being accessed. */
  resource?: {
    /** For "own-only" checks (e.g., Member can update own project). */
    createdById?: string;
    /** For member management (removing/changing role of another user). */
    targetMembership?: Pick<WorkspaceMembership, "userId" | "role">;
    /** For member management (new role being assigned/invited). */
    newRole?: WorkspaceRole;
  };
}

// ─── Role Hierarchy Helpers ─────────────────────────────────────────────

const ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

function isAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

// ─── Permission Logic ───────────────────────────────────────────────────

/**
 * Single enforcement point for the RBAC permission matrix.
 *
 * Returns `true` if the action is allowed, `false` otherwise.
 * Pure function — no DB queries, no side effects.
 */
export function can(action: Action, context: AuthorizationContext): boolean {
  const { role, userId, canDeleteProjects, canDeleteBoards } =
    context.membership;

  switch (action) {
    // ── Workspace ─────────────────────────────────────────────────────
    case "workspace:view_settings":
      // All roles: ✅
      return true;

    case "workspace:update_settings":
      // Owner: ✅, Admin: ✅, Member: ❌
      return isAtLeast(role, "ADMIN");

    case "workspace:delete":
      // Owner: ✅, Admin: ❌, Member: ❌
      return role === "OWNER";

    // ── Members ───────────────────────────────────────────────────────
    case "member:view":
      // All roles: ✅
      return true;

    case "member:invite": {
      // Owner: ✅, Admin: ✅ (but cannot invite Owners), Member: ❌
      if (!isAtLeast(role, "ADMIN")) return false;
      if (role === "ADMIN" && context.resource?.newRole === "OWNER") return false;
      return true;
    }

    case "member:remove": {
      // Owner: ✅ (can remove anyone)
      // Admin: ✅ for Members and other Admins, ❌ for Owners
      // Member: ❌
      if (role === "MEMBER") return false;
      if (role === "OWNER") return true;
      // Admin: can remove Members and Admins, but not Owners
      const targetRole = context.resource?.targetMembership?.role;
      if (!targetRole) return false;
      return targetRole !== "OWNER";
    }

    case "member:change_role": {
      // Owner: ✅ (can set any role)
      // Admin: 🟡 (Member↔Admin only, cannot touch Owner)
      // Member: ❌
      if (role === "MEMBER") return false;
      if (role === "OWNER") return true;
      // Admin: can toggle Member↔Admin, cannot change Owner role
      const targetRole = context.resource?.targetMembership?.role;
      if (!targetRole) return false;
      if (targetRole === "OWNER") return false;
      // Admin cannot promote someone to Owner
      if (context.resource?.newRole === "OWNER") return false;
      return true;
    }

    case "member:transfer_ownership":
      // Owner: ✅, Admin: ❌, Member: ❌
      return role === "OWNER";

    case "member:grant_delete_permission":
      // Owner: ✅, Admin: ✅, Member: ❌
      return isAtLeast(role, "ADMIN");

    // ── Projects ──────────────────────────────────────────────────────
    case "project:create":
    case "project:view":
      // All roles: ✅
      return true;

    case "project:update":
      // Owner: ✅, Admin: ✅, Member: 🟡 (own-created only)
      if (isAtLeast(role, "ADMIN")) return true;
      return context.resource?.createdById === userId;

    case "project:delete":
      // Owner: ✅, Admin: ✅, Member: 🟡 (only if canDeleteProjects granted)
      if (isAtLeast(role, "ADMIN")) return true;
      return canDeleteProjects;

    // ── Boards & Tasks ────────────────────────────────────────────────
    case "board:create":
    case "board:view":
      // All roles: ✅
      return true;

    case "board:delete":
      // Owner: ✅, Admin: ✅, Member: 🟡 (only if canDeleteBoards granted)
      if (isAtLeast(role, "ADMIN")) return true;
      return canDeleteBoards;

    case "task:create":
    case "task:edit":
    case "task:assign":
      // All roles: ✅
      return true;

    // ── Documents ─────────────────────────────────────────────────────
    case "document:create":
    case "document:edit":
    case "document:view_history":
      // All roles: ✅
      return true;

    case "document:delete":
      // Owner: ✅, Admin: ✅, Member: ❌
      return isAtLeast(role, "ADMIN");

    // ── Channels & Messages ───────────────────────────────────────────
    case "channel:create":
      // All roles: ✅
      return true;

    case "channel:delete":
      // Owner: ✅, Admin: ✅, Member: ❌
      return isAtLeast(role, "ADMIN");

    case "message:post":
    case "message:edit_own":
    case "message:delete_own":
      // All roles: ✅
      return true;

    case "message:moderate":
      // Owner: ✅, Admin: ✅, Member: ❌
      return isAtLeast(role, "ADMIN");

    // ── AI ─────────────────────────────────────────────────────────────
    case "ai:use":
      // All roles: ✅ (rate limits are the real control, not RBAC)
      return true;

    default: {
      // Exhaustive check — TypeScript will error if an Action is unhandled.
      const _exhaustive: never = action;
      return false;
    }
  }
}

// ─── Express Middleware Wrapper ──────────────────────────────────────────

/**
 * Middleware factory that checks permissions before allowing a route handler.
 *
 * Usage: router.post('/projects', requirePermission('project:create'), handler)
 *
 * Reads `req.membership` (set by workspace-scope middleware) and calls can().
 * Returns 403 on denial.
 *
 * For actions that need resource context (e.g., own-only checks), the route
 * handler should call can() directly with the appropriate context.
 */
export function requirePermission(action: Action) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const membership = req.membership;

    if (!membership) {
      next(
        new ForbiddenError("No workspace membership found on request context")
      );
      return;
    }

    if (!can(action, { membership })) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}
