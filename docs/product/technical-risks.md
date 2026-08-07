# Technical Risks — SyncSpace

Status: Draft for approval | Gates: Phase 3 Architecture

This document identifies the highest-leverage technical risks that must be resolved — not just acknowledged — before database and API design begins. Each risk includes the decision required, the recommendation, and what happens if we get it wrong.

---

## 1. Real-Time Document Conflict Resolution

**Risk:** Concurrent edits to the same document must converge deterministically. Get this wrong and users silently lose work — the single most damaging failure mode a collaboration tool can have.

**Options considered:**
- **Last-write-wins** — simplest, but actively loses data under concurrent edits. Disqualified.
- **Operational Transform (OT)** — used by Google Docs; correct but algorithmically complex to implement correctly from scratch. High risk of subtle bugs (this is the category of bug that took Google years to get fully right).
- **CRDT (e.g., Yjs)** — mathematically guaranteed convergence, mature library ecosystem, integrates with React and Socket.IO transport without hand-rolling the merge algorithm.

**Decision: CRDT via Yjs.**

**Why this matters for portfolio value:** implementing Yjs correctly — awareness/presence protocol, persistence of the CRDT doc state, efficient diffing over the socket transport — is still substantial, defensible engineering work. It is not "using a library instead of doing the work"; it's choosing the correct tool so the work you do is on integration and scaling, not reinventing OT.

**If wrong:** silent data loss under concurrent edits, or a multi-week detour reimplementing OT badly.

---

## 2. Auth Vendor Lock-In (Clerk)

**Risk:** Clerk is now the confirmed choice, prioritizing dev velocity. This is a deliberate tradeoff, not an oversight — but it creates dependency risk that needs a stated mitigation, not just acceptance.

**Exposure:**
- User identity and session data live in Clerk's system, not our database.
- Pricing changes or API deprecations are outside our control.
- Migration cost if we ever needed to leave: moderate — Clerk supports exporting user records, but session/auth logic, org-to-workspace mapping, and RBAC hooks would need to be rebuilt against Auth.js or another provider.

**Mitigation (required before Phase 3):**
- Keep our own `User` and `WorkspaceMembership` tables in Postgres, keyed by Clerk's `userId`, rather than treating Clerk as the sole source of truth for anything beyond authentication. This is the standard pattern and keeps our domain data portable even if Clerk isn't.
- Isolate all Clerk SDK calls behind a thin internal auth service module — no Clerk imports scattered through route handlers. This bounds the blast radius of a future migration to one module.

**If wrong (no mitigation):** a provider swap later would touch every authorization check in the codebase instead of one module.

**ADR required:** Yes — this belongs in ADR-001 alongside the tech stack rationale, explicitly recording that Clerk was chosen for velocity with the above mitigations accepted as the tradeoff.

---

## 3. AI Service Dependency

**Risk:** AI features (thread summarization, document draft-assist) depend on an external LLM provider. Unbounded calls create cost, latency, and availability risk.

**Open decision (needed before Phase 8, but constraints must be set now):** which provider — not blocking Phase 3, but the *guardrails* below are architectural and must be designed in from the start, not retrofitted.

**Required guardrails:**
- Hard input length caps per AI request (truncate thread/document context before sending).
- Per-user and per-workspace rate limits on AI endpoints, enforced server-side.
- Streamed responses (not blocking request/response) so UI doesn't hang on slow generations.
- Graceful degradation: if the AI provider errors or times out, the feature fails visibly and cheaply (toast/error state) — it must never block the core board/doc/chat experience, since those have zero AI dependency.

**If wrong:** a slow or down AI provider degrades the entire app instead of just the AI feature, or an unbounded prompt blows up cost on a single request.

---

## 4. Multi-Tenant Data Isolation

**Risk:** A single missed authorization check leaks one workspace's data into another. This is the failure mode most likely to happen silently and be discovered latest (e.g., by a reviewer, not a test).

**Options considered:**
- **Database-per-tenant** — strongest isolation, but massive operational overhead (migrations × N tenants) — wrong scale for this project.
- **Schema-per-tenant** — better than nothing, still operationally heavy, awkward with Prisma's migration model at this scale.
- **Row-level scoping (shared schema, `workspaceId` on every tenant-owned table)** — standard approach for this scale; isolation correctness depends entirely on disciplined enforcement.

**Decision: Row-level scoping, enforced at the query layer, not the route layer.**

**Required implementation pattern (binding for Phase 5 backend work):**
- Every Prisma model that belongs to a workspace has a required `workspaceId` foreign key.
- All reads/writes go through a shared repository helper that injects `workspaceId` from the authenticated session automatically — individual route handlers must not be trusted to remember to filter by workspace manually.
- A test suite specifically attempts cross-workspace access (Workspace A's authenticated user requesting Workspace B's project/doc/task IDs) and asserts 403/404 across every entity type. This test suite is a Phase 5 exit criterion, not optional polish.

**If wrong:** a single forgotten `.where({ workspaceId })` clause anywhere in the codebase becomes a data breach, not a bug ticket.

---

## Risk Summary

| Risk | Decision | Status |
|---|---|---|
| Conflict resolution | CRDT (Yjs) | Recommended — confirm before Phase 3 |
| Auth vendor lock-in | Clerk + isolation mitigations | Confirmed, mitigations required |
| AI dependency | Guardrails defined; provider TBD | Guardrails binding now, provider decided Phase 8 |
| Multi-tenant isolation | Row-level scoping via shared repository layer | Recommended — binding for Phase 5 |

**Exit criteria for this document:** All four decisions above confirmed or amended before Phase 3 architecture and database schema work begins.