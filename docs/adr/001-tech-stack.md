# ADR-001: Technology Stack Selection

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Project owner + technical mentor discussion (Phases 1-2)

---

## Context

SyncSpace needs a stack that supports: real-time multi-user document editing with conflict-free convergence, horizontally scalable WebSocket infrastructure, strict multi-tenant data isolation, and a credible engineering portfolio trail (tests, CI/CD, observability). Every choice below is evaluated against two criteria simultaneously: **does it solve the actual technical problem**, and **does it demonstrate engineering depth to a technical reviewer** — since this project explicitly serves as an educational/portfolio artifact (per Vision Doc, Section 3a).

---

## Decisions

### Frontend: React + TypeScript + Tailwind CSS + Vite
**Alternatives considered:** Next.js (App Router), Vue, Svelte.
**Decision: plain React + Vite, not Next.js.** Next.js's SSR/routing conventions add framework-specific complexity that doesn't serve this project's core demonstration goals (real-time sync, not SEO/SSR). Vite gives fast local dev iteration without that overhead. TypeScript is non-negotiable — untyped state across a real-time, multi-client sync system is a correctness risk this project shouldn't take on. Tailwind for velocity on a project where UI polish is secondary to systems engineering.
**Consequence:** no built-in SSR/routing — client-side routing (React Router) and any SEO needs are out of scope, which is acceptable since this isn't a public marketing site.

### Backend: Node.js + Express
**Alternatives considered:** NestJS, Fastify, Go, Python/FastAPI.
**Decision: Express**, not a heavier framework. NestJS's DI/module system is well-suited to large teams but adds ceremony that obscures the parts of the codebase actually worth demonstrating (the real-time layer, the auth middleware, the tenant isolation logic). A thinner framework keeps that logic visible and hand-built rather than hidden behind framework magic — consistent with the Engineering Vision goal of the code itself being the demonstration.
**Consequence:** more manual structure required (no built-in DI, module boundaries) — mitigated by an explicit, documented folder structure in Phase 5.

### Database: PostgreSQL + Prisma
**Alternatives considered:** MongoDB, raw SQL/Knex, Drizzle ORM.
**Decision: PostgreSQL.** Relational integrity (foreign keys, constraints) is a direct asset for the multi-tenant isolation model (Technical Risks doc, Risk #4) — `workspaceId` foreign keys with proper constraints are exactly the kind of guarantee a document store doesn't give for free. **Prisma** over raw SQL/Knex/Drizzle: strong TypeScript type generation reduces a class of bugs across a codebase with this much cross-cutting authorization logic; migration tooling is mature enough not to be a project risk itself.
**Consequence:** Prisma's query flexibility is lower than raw SQL for very complex queries — acceptable tradeoff at this project's scale; can drop to raw SQL via Prisma's `$queryRaw` for the rare case that needs it.

### Real-Time Sync Engine: Yjs (CRDT) over Socket.IO transport
**Alternatives considered:** hand-rolled Operational Transform, ShareDB, Socket.IO rooms alone with last-write-wins.
**Decision: Yjs**, per Technical Risks doc Risk #1. Provides mathematically guaranteed convergence without implementing OT from scratch. **Socket.IO** (not raw WebSockets) for the transport layer — its room abstraction and automatic reconnection/fallback handling solve real operational problems (mobile networks, corporate proxies) that raw WebSockets would require rebuilding.
**Consequence:** Yjs's document model constrains how document state is structured (CRDT-native types) — the persistence layer must serialize/deserialize Yjs state, not arbitrary JSON, which is a real design constraint carried into Phase 4 (database design).

### Horizontal Scaling: Redis via Upstash (pub/sub adapter for Socket.IO + caching)
**Alternatives considered:** sticky sessions only (no cross-instance sync), Kafka/NATS for event bus, self-hosted Redis on the same host as the backend.
**Decision: Redis**, specifically the `@socket.io/redis-adapter` pattern, so real-time events propagate correctly across multiple backend instances — required to make the "horizontally scalable real-time layer" claim (Vision Doc positioning) actually true rather than aspirational. Kafka/NATS would be over-engineered for this project's message volume; Redis is the right-sized tool.
**Provider: Upstash**, chosen specifically for the zero-cost constraint (this project is self-funded, built for a resume portfolio, not a company). Upstash's free tier (256MB, 500K commands/month) runs indefinitely with no card required and no expiry — unlike Render's bundled free Redis, which is capped at 25MB and loses data on every restart. Upstash also decouples Redis from whichever host runs the backend, which keeps the deployment story flexible.
**Consequence:** adds an operational dependency (Redis must be reachable by all backend instances) — captured in Docker Compose (local Redis container) for local dev, with Upstash as the equivalent managed service in deployment (Phase 10). 500K commands/month is a real ceiling worth monitoring once load-testing begins in Phase 12 — flagged as a thing to watch, not an immediate blocker.

### Authentication: Clerk
**Alternatives considered:** Auth.js (self-hosted sessions/JWT).
**Decision: Clerk**, prioritizing development velocity — explicitly revisited and confirmed after initially recommending Auth.js for portfolio depth. **Accepted tradeoff:** less auth implementation code to showcase, in exchange for faster delivery of the features that are the actual differentiator (real-time sync).
**Required mitigations (binding, per Technical Risks doc Risk #2):**
- Domain `User` and `WorkspaceMembership` tables remain in our own Postgres database, keyed by Clerk's `userId` — Clerk is not the sole source of truth for anything beyond authentication itself.
- All Clerk SDK calls isolated behind a single internal auth service module — no direct Clerk imports in route handlers — to bound the blast radius of any future migration.
**Consequence:** vendor dependency on Clerk's pricing/availability; mitigated, not eliminated, by the above.
**Cost check:** Clerk's free tier covers 50,000 Monthly Retained Users per application, including Organizations (with limits) on the free plan — this comfortably covers a portfolio project with no real user base, so no cost risk here despite the zero-budget constraint.

### Storage: Deferred (post-MVP) — decision revisited for zero-cost constraint
File attachments are out of MVP scope (Vision Doc, Product Pillars). The earlier recommendation of S3 (for the presigned-URL/IAM portfolio signal) needs one caveat given the zero-cost constraint: **AWS's S3 free tier is time-limited to 12 months from account creation**, not indefinite like Clerk, Neon, or Upstash. Cloudinary's free tier has no such expiry, just usage caps. This doesn't need a final decision now since the feature is deferred, but it's flagged so the eventual choice weighs "stronger skill signal, but a ticking clock" (S3) against "no expiry, but a less differentiated vendor SDK" (Cloudinary) — worth revisiting with fresh pricing research when that phase actually starts.

### Deployment: Vercel (frontend) + Render (backend) + Neon (database) + Upstash (Redis) — all free tier
**Alternatives considered:** Railway (backend+DB), single-provider deploy, self-managed VPS, AWS ECS/Fargate.
**Revised for the zero-cost constraint** — this changes the earlier default recommendation, based on checking current 2026 pricing rather than assuming it hasn't moved:
- **Railway dropped.** Railway's meaningful free tier is effectively gone — its free credit covers only a few hours of runtime, not a persistently-running backend.
- **Render (backend web service): kept, free tier confirmed usable.** Free web services get 750 instance-hours/month and sleep after 15 minutes of inactivity (30-60s cold start on the next request). Acceptable tradeoff for a portfolio project — a recruiter clicking a link after it's been idle sees a brief cold start, not a bill.
- **Database moved off Render's free Postgres, onto Neon.** This is the important catch: Render's free Postgres **expires after 30 days** (14-day grace period, then deletion) — a real risk for a project meant to stay demoable long-term. Neon's free tier never expires, gives 0.5GB storage (5GB across up to 10 projects), and scales to zero when idle (~500ms cold start on first query) — the right fit for a project with sparse, bursty traffic instead of constant load.
- **Vercel (frontend): unchanged**, free Hobby tier is sufficient for a non-commercial personal project.
**Consequence:** four free-tier services to keep in sync (CORS, environment variables, connection strings) instead of two — more moving parts, but each one individually verified to have a durable (not time-bombed) free tier as of mid-2026. Worth re-verifying pricing pages before Phase 10 deployment, since free-tier terms are exactly the kind of thing that changes without much notice.

### Containerization: Docker
Used for local development parity (`docker-compose` running Postgres, Redis, backend together) and as the basis for CI build/test consistency. Not necessarily the production deployment mechanism (Railway/Render may build from source directly) — Docker's role here is primarily reproducibility, not production packaging.

### CI/CD: GitHub Actions
**Alternatives considered:** CircleCI, GitLab CI.
**Decision: GitHub Actions** — free for public repos, colocated with source, and the most recognizable CI tool to a reviewer skimming the repo's `.github/workflows` directory.

### Testing: Jest + React Testing Library + Playwright
Jest for backend unit/integration tests (including the RBAC matrix test suite and cross-tenant isolation test suite specified in the Technical Risks and RBAC docs). RTL for component-level frontend tests. Playwright for E2E flows spanning real-time multi-client scenarios (e.g., simulating two browser contexts editing the same document) — this is the tool best suited to actually proving the CRDT convergence claims end-to-end, not just at the unit level.

### Monitoring: Sentry
Error tracking and performance monitoring on both frontend and backend. Chosen for ease of integration and because latency/error visibility on the real-time layer is itself a claim this project needs to back up (Vision Doc, Success Definition — documented p95 latency).
**Cost check:** Sentry's Developer plan is free indefinitely (5,000 errors/month, 1 user) — sufficient for a solo-built portfolio project.

### Flag for Phase 8: AI provider must be chosen with the same zero-cost discipline
Not a decision yet — this is a placeholder so it isn't forgotten. Unlike the infra above, most LLM APIs charge per token with no indefinitely-free tier at meaningful volume. When Phase 8 arrives, the provider choice needs the same "verify current free-tier/credit terms" treatment as the infra decisions above, plus the cost guardrails already specified in the Technical Risks doc (input caps, rate limits) — those guardrails matter even more under a hard zero-budget constraint than they did under the original assumption of "some" budget.

---

## Consequences Summary

**What this stack buys us:** a credible engineering story across the full stack — typed frontend, relationally-enforced multi-tenant backend, CRDT-correct real-time sync, horizontally scalable socket layer, and a documented CI/testing/observability trail — built entirely on indefinitely-free infrastructure (Vercel, Render, Neon, Upstash, Clerk, Sentry, GitHub Actions), verified against 2026 pricing rather than assumed.

**What we're accepting:** Clerk as a vendor dependency (mitigated via the isolation pattern above), a four-service deployment footprint instead of one or two, Prisma's query flexibility ceiling in exchange for type safety and migration velocity, and Render's cold-start delay on the free tier as the price of zero cost.

**Revisit triggers:** if Clerk pricing or terms change materially, if any of the free tiers above change their terms (they're individually verified as of mid-2026 but not contractually guaranteed to stay that way), or if Render's WebSocket/cold-start behavior becomes a real blocker for demoing real-time features, this ADR should be revisited rather than silently worked around.