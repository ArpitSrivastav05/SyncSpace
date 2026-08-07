# Architecture — SyncSpace

Status: Draft for review | Phase 3

---

## 1. System Overview

SyncSpace has four moving parts: a static React frontend (Vercel), a single backend service handling both REST and WebSocket traffic (Render), a relational database (Neon Postgres), and a pub/sub + cache layer (Upstash Redis), with Clerk as an external identity provider. See the system diagram above for the component map, and the real-time sync diagram for how an edit propagates across instances.

## 2. Service Boundaries: Modular Monolith, Not Microservices

**Decision:** one backend service (Express + Socket.IO on Render), internally organized into clear modules — not split into separate microservices.

**Why:** microservices solve problems SyncSpace doesn't have — independent team deployment, independently scaling hot paths, polyglot tech per service. At this scale, splitting into services would mean network calls (and their failure modes) between, say, the board service and the notification service, for zero actual benefit — and it directly conflicts with the zero-cost deployment constraint from ADR-001 (each service would need its own free-tier host, most of which sleep independently, compounding cold-start pain).

**What this means concretely:** the backend is one Express app with clearly separated internal modules (auth, workspaces, projects, boards, documents, chat, ai) that don't share state directly — they communicate through well-defined service functions, the same discipline you'd want if they were ever split into real microservices later. This is deliberately structured so that a future split is possible without a rewrite, even though we're not doing it now — matching the "prove the hardest thing first" principle from the Vision doc: the hard problem here is correctness (real-time sync, tenant isolation), not service topology.

**The one exception:** Socket.IO's real-time layer is logically separate from the REST API even though it lives in the same process — it has its own room/namespace model, its own Redis adapter connection, and its own event handlers. Structurally isolated in the folder layout (see below) even though operationally it's the same deployment.

## 3. Real-Time Architecture (Detail)

Building on the diagram above:

- **Document editing:** each open document is a Socket.IO **room**, keyed by document ID. Clients join the room on open, leave on close.
- **CRDT layer:** Yjs manages document state as a CRDT. Local edits produce binary update deltas — these are what actually travel over the wire, not the full document, keeping payloads small regardless of document size.
- **Persistence:** rather than a single overwritten blob, each Yjs update is stored as its own row in an update-log table: `(id, document_id, update_bytes, client_id, created_at)`. This is a real, queryable table — not an opaque blob — even though each row's payload is binary CRDT data (that part is non-negotiable; decomposing a CRDT into arbitrary relational columns would mean reimplementing Yjs's merge guarantees ourselves). This design gets three concrete benefits over a single blob: **incremental sync** (a reconnecting client can request only updates since its last known point, not the full document state), **a genuine version/audit trail** (every update is individually timestamped and attributable to a client), and **avoids full-row rewrites** on every save. **Compaction:** periodically (e.g., once the log exceeds N rows or M minutes since last compaction), the updates are merged into a single snapshot row and the individual update rows older than that snapshot are deleted — keeping the table from growing unbounded while preserving recent granular history.
- **Presence/awareness:** Yjs's awareness protocol (separate from document content) carries ephemeral state — cursor position, selection, "who's online" — over the same Socket.IO room, but this state is never persisted; it's rebuilt on reconnect.
- **Horizontal scaling:** the `@socket.io/redis-adapter` (backed by Upstash) ensures a room's members can be spread across multiple Render instances and still receive each other's events — this is what the second diagram demonstrates.
- **Board and chat real-time updates:** simpler than documents — no CRDT needed, since a task move or chat message isn't a concurrent-edit problem, just an event broadcast. These use plain Socket.IO rooms keyed by board ID and channel ID respectively (not project ID — since Phase 4 revised the hierarchy to allow multiple boards and channels per project, a room has to be scoped to the specific board or channel a client is viewing, not the whole project).

## 4. Folder Structure

```
syncspace/
├── apps/
│   ├── frontend/                 # React + TS + Vite
│   │   ├── src/
│   │   │   ├── features/         # one folder per domain: boards, documents, chat, auth
│   │   │   ├── components/       # shared UI primitives
│   │   │   ├── lib/               # API client, socket client, Yjs setup
│   │   │   └── routes/
│   │   └── ...
│   └── backend/                  # Express + Socket.IO
│       ├── src/
│       │   ├── modules/          # auth, workspaces, projects, boards, documents, chat, ai
│       │   │   └── {module}/
│       │   │       ├── {module}.routes.ts
│       │   │       ├── {module}.service.ts
│       │   │       ├── {module}.repository.ts
│       │   │       └── {module}.test.ts
│       │   ├── realtime/         # Socket.IO setup, room handlers, Yjs sync logic
│       │   │   ├── socket-server.ts
│       │   │   ├── redis-adapter.ts
│       │   │   └── document-sync.ts
│       │   ├── middleware/       # auth verification, workspace-scoping, rate limiting
│       │   ├── lib/              # prisma client, redis client, clerk client
│       │   └── app.ts
│       └── prisma/
│           └── schema.prisma
├── packages/
│   └── shared/                   # types shared between frontend and backend (API contracts)
├── docs/
│   ├── product/                  # vision.md, PRD.md
│   ├── adr/                      # 001-tech-stack.md, future ADRs
│   └── architecture.md           # this file
├── docker-compose.yml            # local Postgres + Redis for dev
└── .github/workflows/            # CI/CD
```

**Why this shape:** `apps/` + `packages/` is a lightweight monorepo pattern (no heavy tooling like Turborepo required at this scale — npm/pnpm workspaces are enough). The `modules/` structure inside the backend mirrors the module boundaries from Section 2 — each module owns its routes, business logic, and data access, so the authorization helper from the RBAC doc and the tenant-scoping helper from the Technical Risks doc live in `middleware/` and get applied uniformly across every module rather than reimplemented per-module.

**Rejected alternative:** separate repos for frontend/backend. A monorepo keeps the shared API contract types (`packages/shared`) in sync automatically — a mismatched request/response shape becomes a TypeScript error at build time instead of a runtime bug, which matters a lot for a project with this much cross-cutting real-time state.

## 5. Security Architecture

Consolidating the security-relevant decisions already made across the Technical Risks, RBAC, and ADR-001 docs into one architectural view:

- **Authentication boundary:** Clerk issues the session; the backend verifies it on every request via Clerk's server SDK in an auth middleware — no route handler trusts a client-supplied user ID directly.
- **Authorization boundary:** the `can(user, action, resource)` helper (RBAC doc) is the single enforcement point, called from every mutating route — not reimplemented per-module.
- **Tenant isolation boundary:** the repository layer (Technical Risks doc, Risk #4) auto-injects `workspaceId` scoping on every query — application code never manually filters by workspace, removing the "forgot the where clause" failure mode.
- **Real-time authorization:** Socket.IO connections are authenticated at the handshake (verify Clerk session before allowing the connection), and room-join requests re-check workspace/project membership — a client can't join a document room it doesn't have access to just by knowing the document ID.
- **Rate limiting:** applied at the middleware layer using Upstash Redis as the counter store — both on AI endpoints (Technical Risks doc, Risk #3) and generally on auth-sensitive endpoints (login attempts, invite creation) to prevent abuse.
- **CORS:** explicitly configured allowlist (Vercel frontend origin only) on the Render backend — not a wildcard, since this is a credentialed, session-based API.

## 6. Testing Strategy (Architectural View)

Mapping test types to the architecture above, per the original Jest/RTL/Playwright stack decision:

- **Unit tests (Jest):** module `.service.ts` business logic in isolation; the `can()` authorization helper against the full RBAC matrix (every row a test case, per the RBAC doc); the tenant-scoping repository helper.
- **Integration tests (Jest + test database):** module `.routes.ts` against a real (test) Postgres instance — catches issues unit tests with mocks would miss, especially around Prisma query correctness and the cross-tenant isolation test suite specified in the Technical Risks doc.
- **Component tests (RTL):** frontend `features/` components, particularly around real-time state rendering (presence indicators, live board updates).
- **E2E (Playwright):** full user journeys, and critically, **multi-client scenarios** — two Playwright browser contexts opening the same document and asserting both converge to the same content after concurrent edits. This is the test that actually proves the CRDT convergence claim from the Vision doc's Success Definition, not just a unit test on Yjs itself (which is already well-tested upstream).

## 7. Deployment Topology (Recap + Detail)

Matches ADR-001's revised, cost-verified stack:

```
Vercel (frontend, static build)
   ↓ REST + WSS
Render (backend: Express + Socket.IO, single service)
   ↓ Prisma            ↓ ioredis client
Neon Postgres          Upstash Redis
(scale-to-zero)        (pub/sub + rate limit counters)
```

- **CI/CD (GitHub Actions):** on push to main — run lint, typecheck, unit + integration tests, then trigger deploys (Vercel auto-deploys on push; Render auto-deploys on push to the connected branch).
- **Environments:** local (Docker Compose: Postgres + Redis containers, matching Neon/Upstash locally) → main branch auto-deploys to the single production environment. No staging environment in MVP — a deliberate scope cut consistent with "depth over breadth"; a staging environment is valuable but not something a portfolio reviewer evaluates.
- **Secrets:** Clerk keys, database URL, Redis URL stored as environment variables in Vercel/Render dashboards — never committed, `.env.example` documents required variables without values.

## 8. Engineering Tradeoffs Summary

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Service topology | Modular monolith | Microservices | Matches actual scale; avoids network-call complexity and multi-host cold-start pain |
| Repo structure | Monorepo (apps/packages) | Separate repos | Shared type contracts enforced at build time |
| Real-time transport | Socket.IO + Redis adapter | Raw WebSockets | Reconnection/fallback handling solved for free; Redis adapter is the documented, standard scaling pattern |
| Document sync | Yjs (CRDT) | Hand-rolled OT | Mathematically guaranteed convergence without reimplementing a notoriously hard algorithm |
| Document persistence | Update-log table (Option B) | Single overwritten blob | Incremental sync, audit trail, no full-row rewrites — while keeping CRDT correctness intact |
| Staging environment | None (MVP) | Full staging env | Scope discipline — not evaluated by a portfolio reviewer, adds deployment complexity |

## Exit Criteria

- [ ] Modular monolith decision confirmed (vs. reconsidering microservices)
- [ ] Folder structure approved — flag if module boundaries should be different
- [ ] Real-time architecture (Yjs + Socket.IO rooms + Redis adapter + periodic persistence) confirmed as the binding design for Phase 7
- [ ] Security architecture confirmed as binding constraints for Phase 5/6 implementation
- [ ] Ready to proceed to Phase 4: Database Design (Prisma schema, including how Yjs binary state is stored)