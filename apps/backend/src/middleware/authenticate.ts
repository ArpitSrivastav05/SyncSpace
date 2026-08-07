import {
  clerkMiddleware,
  getAuth,
  type ClerkMiddlewareOptions,
} from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { findOrCreateUser } from "../modules/auth/auth.service.js";
import { UnauthorizedError } from "../lib/errors.js";

import type { User } from "@prisma/client";

/**
 * Extend Express Request to carry our domain User.
 *
 * Route handlers access `req.user` — never Clerk's raw auth object.
 * The Clerk auth object (req.auth) is an implementation detail of this
 * middleware layer and should not leak into business logic.
 */
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Clerk session verification middleware.
 *
 * Architecture reference: architecture.md §5
 * "Clerk issues the session; the backend verifies it on every request
 * via Clerk's server SDK in an auth middleware — no route handler trusts
 * a client-supplied user ID directly."
 *
 * This file is one of exactly TWO files that import from @clerk/express.
 * The other is auth.service.ts (the domain-level Clerk isolation module).
 * authenticate.ts handles the framework integration boundary (session
 * verification); auth.service.ts handles the domain boundary (user sync).
 */

const clerkOptions: ClerkMiddlewareOptions = {};

/**
 * Initializes Clerk's session verification.
 * This should be applied globally (app.use) so every request has
 * `req.auth` available, even for unauthenticated routes.
 */
export const clerkSessionMiddleware = clerkMiddleware(clerkOptions);

/**
 * Requires a valid authenticated session.
 *
 * Flow:
 * 1. Reads req.auth.userId (set by clerkSessionMiddleware above).
 * 2. Calls auth.service.findOrCreateUser() to translate Clerk identity
 *    into our domain User (creating on first login).
 * 3. Attaches req.user (our domain User) for downstream handlers.
 * 4. Throws 401 if no valid session.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const auth = getAuth(req);

    if (!auth?.userId) {
      throw new UnauthorizedError("Authentication required");
    }

    // Translate Clerk identity into our domain User.
    // This is the boundary where Clerk's auth object stops and our
    // domain model begins.
    req.user = await findOrCreateUser(auth.userId);

    next();
  } catch (error) {
    next(error);
  }
}
