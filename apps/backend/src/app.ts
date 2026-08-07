import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { clerkSessionMiddleware } from "./middleware/authenticate.js";
import { errorHandler } from "./middleware/error-handler.js";
import { workspaceRouter } from "./modules/workspaces/workspaces.routes.js";
import { inviteRouter } from "./modules/workspaces/invites.routes.js";

/**
 * Express app factory.
 *
 * Separated from server.ts so integration tests can import the app
 * without binding a real port (standard pattern for supertest).
 */
export function createApp(): express.Express {
  const app = express();

  // ─── Global Middleware ──────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: process.env["CORS_ORIGIN"] || "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  // Clerk session verification — applied globally so req.auth is
  // available on every request (even unauthenticated ones).
  app.use(clerkSessionMiddleware);

  // ─── Health Check ───────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ─── Routes ─────────────────────────────────────────────────────────
  app.use("/api/workspaces", workspaceRouter);
  app.use("/api/invites", inviteRouter);

  // ─── Error Handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
}
