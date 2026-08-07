import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/authenticate.js";
import { requirePermission, can } from "../../middleware/authorize.js";
import { workspaceScope } from "../../middleware/workspace-scope.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../lib/errors.js";
import * as service from "./workspaces.service.js";

import type { WorkspaceRole } from "@prisma/client";

/**
 * Workspace routes — CRUD, member management, and invite endpoints.
 *
 * All workspace-scoped routes use:
 *   requireAuth → workspaceScope → requirePermission(action) → handler
 *
 * This ensures:
 * 1. Session is verified (Clerk)
 * 2. User is a member of the workspace (membership check)
 * 3. User has the required role/permission for the action (RBAC)
 */

export const workspaceRouter = Router();

// ─── Workspace CRUD ──────────────────────────────────────────────────────

// POST /api/workspaces — Create workspace (any authenticated user)
workspaceRouter.post(
  "/",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        throw new BadRequestError("Workspace name is required");
      }

      const workspace = await service.createWorkspace(req.user!, {
        name: name.trim(),
      });
      res.status(201).json(workspace);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/workspaces — List user's workspaces
workspaceRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaces = await service.listUserWorkspaces(req.user!.id);
      res.json(workspaces);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/workspaces/:workspaceId — Get workspace details
workspaceRouter.get(
  "/:workspaceId",
  requireAuth,
  workspaceScope,
  requirePermission("workspace:view_settings"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await service.getWorkspace(req.params["workspaceId"]!);
      res.json(workspace);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/workspaces/:workspaceId — Update workspace
workspaceRouter.patch(
  "/:workspaceId",
  requireAuth,
  workspaceScope,
  requirePermission("workspace:update_settings"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body as { name?: string };
      if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
        throw new BadRequestError("Workspace name cannot be empty");
      }

      const workspace = await service.updateWorkspace(
        req.params["workspaceId"]!,
        { name: name?.trim() }
      );
      res.json(workspace);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/workspaces/:workspaceId — Delete workspace (Owner only)
workspaceRouter.delete(
  "/:workspaceId",
  requireAuth,
  workspaceScope,
  requirePermission("workspace:delete"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.deleteWorkspace(req.params["workspaceId"]!);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// ─── Member Management ──────────────────────────────────────────────────

// GET /api/workspaces/:workspaceId/members — List members
workspaceRouter.get(
  "/:workspaceId/members",
  requireAuth,
  workspaceScope,
  requirePermission("member:view"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await service.listMembers(req.params["workspaceId"]!);
      res.json(members);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/workspaces/:workspaceId/members/:userId/role — Change role
workspaceRouter.patch(
  "/:workspaceId/members/:userId/role",
  requireAuth,
  workspaceScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { role } = req.body as { role?: WorkspaceRole };
      if (!role || !["OWNER", "ADMIN", "MEMBER"].includes(role)) {
        throw new BadRequestError("Valid role is required (OWNER, ADMIN, MEMBER)");
      }

      // For change_role, we need the target's current role to check
      // whether the acting user can change it. Fetch target membership first.
      const targetUserId = req.params["userId"]!;
      const targetMembers = await service.listMembers(req.params["workspaceId"]!);
      const targetMembership = targetMembers.find(
        (m) => m.userId === targetUserId
      );

      if (!targetMembership) throw new NotFoundError("Member not found");

      // RBAC check with target context and new role.
      if (
        !can("member:change_role", {
          membership: req.membership!,
          resource: { targetMembership, newRole: role },
        })
      ) {
        throw new ForbiddenError();
      }

      const updated = await service.changeRole(
        req.params["workspaceId"]!,
        targetUserId,
        role,
        { userId: req.user!.id, role: req.membership!.role }
      );
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/workspaces/:workspaceId/transfer-ownership — Transfer ownership
workspaceRouter.post(
  "/:workspaceId/transfer-ownership",
  requireAuth,
  workspaceScope,
  requirePermission("member:transfer_ownership"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.body as { userId?: string };
      if (!userId || typeof userId !== "string") {
        throw new BadRequestError("Target userId is required");
      }

      const updated = await service.transferOwnership(
        req.params["workspaceId"]!,
        userId
      );
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/workspaces/:workspaceId/members/:userId/permissions — Grant/revoke delegated permissions
workspaceRouter.patch(
  "/:workspaceId/members/:userId/permissions",
  requireAuth,
  workspaceScope,
  requirePermission("member:grant_delete_permission"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { canDeleteProjects, canDeleteBoards } = req.body as {
        canDeleteProjects?: boolean;
        canDeleteBoards?: boolean;
      };

      if (canDeleteProjects === undefined && canDeleteBoards === undefined) {
        throw new BadRequestError(
          "At least one permission flag must be provided"
        );
      }

      const updated = await service.updateMemberPermissions(
        req.params["workspaceId"]!,
        req.params["userId"]!,
        { canDeleteProjects, canDeleteBoards }
      );
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/workspaces/:workspaceId/members/:userId — Remove member
workspaceRouter.delete(
  "/:workspaceId/members/:userId",
  requireAuth,
  workspaceScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const targetUserId = req.params["userId"]!;

      // For remove, we need to check the target's role for the Admin constraint.
      const targetMembers = await service.listMembers(req.params["workspaceId"]!);
      const targetMembership = targetMembers.find(
        (m) => m.userId === targetUserId
      );

      if (!targetMembership) throw new NotFoundError("Member not found");

      // RBAC check with target context.
      if (
        !can("member:remove", {
          membership: req.membership!,
          resource: { targetMembership },
        })
      ) {
        throw new ForbiddenError();
      }

      await service.removeMember(
        req.params["workspaceId"]!,
        targetUserId,
        req.membership!.role
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// ─── Invite Management ──────────────────────────────────────────────────

// POST /api/workspaces/:workspaceId/invites — Create invite
workspaceRouter.post(
  "/:workspaceId/invites",
  requireAuth,
  workspaceScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, role } = req.body as { email?: string; role?: WorkspaceRole };
      if (!email || typeof email !== "string") {
        throw new BadRequestError("Email is required");
      }

      if (
        !can("member:invite", {
          membership: req.membership!,
          resource: { newRole: role ?? "MEMBER" },
        })
      ) {
        throw new ForbiddenError();
      }

      const invite = await service.createInvite(
        req.params["workspaceId"]!,
        req.user!.id,
        { email, role }
      );
      res.status(201).json(invite);
    } catch (error) {
      next(error);
    }
  }
);
