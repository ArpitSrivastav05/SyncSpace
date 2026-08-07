import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/authenticate.js";
import { BadRequestError } from "../../lib/errors.js";
import * as service from "./workspaces.service.js";

/**
 * Invite routes — token-based endpoints that don't need workspace scoping
 * (the invite carries the workspaceId itself).
 */

export const inviteRouter = Router();

// POST /api/invites/:token/accept — Accept invite
inviteRouter.post(
  "/:token/accept",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.params["token"];
      if (!token) throw new BadRequestError("Invite token is required");

      const workspace = await service.acceptInvite(token, req.user!);
      res.json({ workspace, message: "Invite accepted" });
    } catch (error) {
      next(error);
    }
  }
);
