# RBAC Permission Matrix — SyncSpace

Status: Draft for approval | Resolves PRD Gap #4 (RBAC ambiguity)

---

## Scope Decision: Workspace-Level Roles Only (MVP)

The open question from the PRD review was: *are permissions per-workspace, per-project, or both?*

**Decision: workspace-level roles only for MVP.** A user's role (Owner / Admin / Member) applies uniformly across every project in that workspace. No per-project role overrides in MVP.

**Why:** per-project permissions multiply the authorization surface (role × project × resource, instead of role × resource) — significantly more complexity in the schema, the authorization middleware, and the test matrix, for a capability none of our three personas (Maya, Raj, Priya) actually asked for. This is the "prove the hardest thing first" principle in practice: real-time sync is the hard problem worth spending complexity budget on; per-project ACLs are not, yet.

**Deferred to post-MVP:** per-project role overrides (e.g., a Member with elevated access on one specific project) and a **Guest** role scoped to a single project with read/comment-only access. Both are additive — they don't require re-architecting the MVP model, just an additional `ProjectMembership` override table layered on top of the workspace-level `WorkspaceMembership` table.

**One targeted exception, added to MVP: delegated delete permission.** Rather than a full per-project ACL system, Admins and Owners can grant an individual Member a specific capability flag — `canDeleteProjects` and/or `canDeleteBoards` — without changing that member's role. This is deliberately narrow: one boolean per capability, workspace-wide (not per-project), toggled by Admin/Owner on a member's profile. It solves the real problem (a trusted Member shouldn't need a full role promotion just to clean up stale boards) without reopening the per-project-ACL complexity we just decided to defer.

## Three Roles (MVP)

| Role | Who | Core idea |
|---|---|---|
| **Owner** | Workspace creator(s) | Full control, including irreversible actions (delete workspace, transfer ownership) |
| **Admin** | Trusted team leads | Manages people and content, cannot destroy the workspace itself |
| **Member** | Everyone else invited | Does the actual work — creates, edits, collaborates — cannot manage membership or delete structural resources |

**Guardrails (binding, not just convention):**
- A workspace must always have **at least one Owner**. The system must block removing or demoting the last remaining Owner — enforced server-side, not just hidden in the UI.
- Multiple Owners are allowed (e.g., co-founders), not just a single fixed owner.
- Admins cannot change or remove an Owner's role — prevents privilege escalation via a compromised or malicious Admin account.
- Workspace deletion is Owner-only and must require explicit confirmation (e.g., typing the workspace name) — this is a UX safeguard on top of the RBAC check, not a substitute for it.

---

## Permission Matrix

**Legend:** ✅ Full access · 🟡 Limited/own-only · ❌ No access

| Resource / Action | Owner | Admin | Member |
|---|---|---|---|
| **Workspace** | | | |
| View workspace settings | ✅ | ✅ | ✅ |
| Update workspace settings (name, icon) | ✅ | ✅ | ❌ |
| Delete workspace | ✅ | ❌ | ❌ |
| Manage billing (post-MVP) | ✅ | ❌ | ❌ |
| **Members** | | | |
| View member list | ✅ | ✅ | ✅ |
| Invite new members | ✅ | ✅ | ❌ |
| Remove a member | ✅ | ✅ (not Owners) | ❌ |
| Change a member's role | ✅ | 🟡 (Member ↔ Admin only, not Owner) | ❌ |
| Transfer/grant Ownership | ✅ | ❌ | ❌ |
| Grant/revoke a Member's delegated delete permission | ✅ | ✅ | ❌ |
| **Projects** | | | |
| Create project | ✅ | ✅ | ✅ |
| View project | ✅ | ✅ | ✅ |
| Update project details | ✅ | ✅ | 🟡 (own-created only) |
| Delete/archive project | ✅ | ✅ | 🟡 (only if `canDeleteProjects` granted) |
| **Boards & Tasks** | | | |
| Create/view board | ✅ | ✅ | ✅ |
| Create/edit/move tasks | ✅ | ✅ | ✅ |
| Assign tasks to others | ✅ | ✅ | ✅ |
| Delete board | ✅ | ✅ | 🟡 (only if `canDeleteBoards` granted) |
| **Documents** | | | |
| Create document | ✅ | ✅ | ✅ |
| Edit document (real-time) | ✅ | ✅ | ✅ |
| View version history | ✅ | ✅ | ✅ |
| Delete document | ✅ | ✅ | ❌ |
| **Channels & Messages** | | | |
| Create channel | ✅ | ✅ | ✅ |
| Post message | ✅ | ✅ | ✅ |
| Edit/delete own message | ✅ | ✅ | ✅ |
| Delete others' messages (moderation) | ✅ | ✅ | ❌ |
| Delete channel | ✅ | ✅ | ❌ |
| **AI Actions** | | | |
| Use AI summarize/draft-assist | ✅ | ✅ | ✅ |
| Rate limits apply | Per-user, all roles equally | Per-user, all roles equally | Per-user, all roles equally |

**Note on AI:** deliberately no role gating beyond rate limits — restricting AI by role would add complexity with no clear product justification, and the real cost control is the per-user/per-workspace rate limit from the technical risks doc, not RBAC.

---

## Enforcement Pattern (ties to Technical Risks doc, Risk #4)

Matching the multi-tenant isolation pattern already decided: role checks happen in the **shared repository/authorization layer**, not scattered in route handlers. Concretely:

- Every mutating action passes through a permission-check helper: `can(user, action, resource)` — a single source of truth for this matrix, not duplicated if/else logic per route.
- This matrix *is* the spec for that helper's test suite — each row above becomes a test case (role × action → allow/deny), so the matrix and the code can't silently drift apart.
- The "last Owner" and "Admin can't touch Owner" guardrails get their own explicit tests, since these are the two rules most likely to have an edge-case bug (e.g., removing the second-to-last Owner while a role change is in flight).
- The delegated `canDeleteProjects`/`canDeleteBoards` flags live on the `WorkspaceMembership` record itself (not a separate table) and are checked by the same `can()` helper — a Member's delete action is authorized if `role` allows it OR the relevant flag is `true`. This keeps the authorization check a single code path instead of two separate systems to keep in sync.

---

## Exit Criteria

- [ ] Three-role model (Owner/Admin/Member) confirmed for MVP, Guest deferred
- [ ] Workspace-level-only scope (no per-project overrides) confirmed for MVP
- [ ] Matrix above reviewed row-by-row — flag anything that should be Admin-only vs Member-allowed differently
- [ ] Last-Owner and Admin-escalation guardrails confirmed as binding, testable requirements for Phase 5