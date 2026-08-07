import type { Request, Response, NextFunction } from "express";
import type { WorkspaceMembership } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  createScopedRepository,
  type ScopedRepository,
} from "../lib/scoped-repository.js";
import { ForbiddenError } from "../lib/errors.js";

/**
 * Extend Express Request to carry workspace-scoping context.
 *
 * Set by the workspaceScope middleware, consumed by route handlers
 * and the requirePermission middleware.
 */
declare global {
  namespace Express {
    interface Request {
      membership?: WorkspaceMembership;
      scopedRepo?: ScopedRepository;
    }
  }
}

/**
 * Workspace-scoping middleware.
 *
 * Architecture reference: architecture.md §5 + technical-risks.md Risk #4
 *
 * 1. Extracts workspaceId from req.params.workspaceId.
 * 2. Verifies the authenticated user has a WorkspaceMembership in that workspace.
 * 3. Attaches req.membership (including role and delegated permission flags).
 * 4. Attaches req.scopedRepo (tenant-scoped repository instance).
 * 5. Returns 403 if the user isn't a member of the workspace.
 *
 * Must be applied AFTER requireAuth (needs req.user to be set).
 */
export async function workspaceScope(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const workspaceId = req.params["workspaceId"];

    if (!workspaceId) {
      throw new ForbiddenError("Workspace ID is required");
    }

    if (!req.user) {
      throw new ForbiddenError("Authentication required before workspace scope");
    }

    // Look up the user's membership in this workspace.
    // This is the authorization boundary — if the user isn't a member,
    // they don't get access to anything in this workspace.
    const membership = await prisma.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: req.user.id,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError(
        "You are not a member of this workspace"
      );
    }

    // Attach membership for downstream authorization checks.
    req.membership = membership;

    // Attach the tenant-scoped repository — all workspace-scoped queries
    // go through this, auto-injecting workspaceId on every operation.
    req.scopedRepo = createScopedRepository(prisma, workspaceId);

    next();
  } catch (error) {
    next(error);
  }
}
