# Database Design — SyncSpace

Status: Draft for review | Phase 4

---

## 1. Hierarchy Decision (revised)

**Workspace → many Projects → many Boards, many Documents, many Channels per Project.**

Originally scoped as one board and one channel per project for simplicity; revised to full nested hierarchy after review. This is a more Notion/Jira-realistic model — a project often genuinely needs more than one board (e.g., a "Sprint board" and a "Bugs board") and more than one channel (e.g., "general" and "announcements"). Consequence: `Board` and `Channel` both gained a `position` field for UI ordering (there was no ordering concern when only one existed per project), and their `projectId` foreign key is no longer unique.

**Additional improvements made at the same time** (not strictly required by the hierarchy change, but natural to add now rather than as a later migration):
- `Task.priority` (LOW/MEDIUM/HIGH enum) — a Kanban board without priority is unusually bare; low complexity, real value.
- `[boardColumnId, position]` compound index on `Task` and `[boardId, position]` on `BoardColumn` — the most common query on a board is "give me this column's tasks in order," and these indexes serve that directly instead of requiring an in-memory sort.
- `Channel.updatedAt` — was missing; added for consistency now that channels are renameable, multi-instance entities rather than a fixed one-per-project fixture.

## 2. Denormalizing `workspaceId`

Every tenant-owned table (`Board`, `Task`, `Document`, `Channel`, `Message`) carries its own `workspaceId`, even though it's technically derivable by walking up through `Project`. This is a deliberate denormalization, not an oversight.

**Why:** the Technical Risks doc (Risk #4) requires that every workspace-scoped query be filterable by `workspaceId` at the repository layer, uniformly, without joins. If `Task` only had `boardColumnId`, checking tenant isolation would require joining `Task → BoardColumn → Board → Project → Workspace` on every single query — easy to get right once, easy to forget on the fifth new endpoint six months from now. A direct, indexed `workspaceId` column on every tenant-owned table means the authorization helper can apply one `WHERE workspaceId = ?` clause everywhere, mechanically, with no exceptions to remember.

**Tradeoff accepted:** `workspaceId` must be kept in sync with the parent chain (e.g., if a task's board ever moved between projects — not a feature we have, but worth naming the constraint). Since projects don't move between workspaces in this design, `workspaceId` is effectively immutable once set, which avoids the sync problem in practice.

**What's not denormalized:** `BoardColumn` and `DocumentUpdate`. These are only ever queried through their direct parent (`boardId`, `documentId`), which is already workspace-scoped one level up — a route handler never queries "give me all board columns in workspace X" directly. Denormalizing here would add columns with no corresponding safety benefit.

## 3. Cascade Delete Strategy

All parent-child relationships use `onDelete: Cascade` (deleting a `Workspace` deletes its `Project`s, which delete their `Board`s, `Document`s, etc.). This matches the RBAC doc's guardrail that workspace deletion is a deliberate, confirmed, irreversible action — once an Owner confirms it, a clean cascading delete is the correct behavior, not orphaned rows scattered across the database.

**Exception worth noting:** `Message` uses soft delete (`deletedAt`) instead of a hard delete, even under a cascading parent. Reasoning: message moderation (an Admin removing an inappropriate message) needs to preserve thread integrity — a hard-deleted parent message would break the `replies` relation for any thread built on top of it. Soft-deleted messages get filtered out at the query layer but don't corrupt reply chains.

## 4. Indexing Strategy

- Every foreign key used in a `WHERE` clause has an index: `workspaceId` on every tenant table (supports the isolation-check pattern), plus relationship-specific indexes (`boardColumnId` on `Task`, `channelId` on `Message`, etc.).
- Compound indexes where queries filter by two columns together: `[documentId, createdAt]` on `DocumentUpdate` (fetching a document's update log in order), `[channelId, createdAt]` on `Message` (fetching a channel's message history in order), `[userId, readAt]` on `Notification` (fetching a user's unread notifications).
- `[workspaceId, userId]` unique constraint on `WorkspaceMembership` — enforces "one membership per user per workspace" at the database level, not just application logic.

## 5. What's Deliberately Not in This Schema

Consistent with the MVP scope cuts already made:
- No `search_vector`/`tsvector` column — full-text search is post-MVP.
- No audit log table — cut from MVP per the earlier vision doc discussion.
- No `Attachment`/file table — storage is deferred (S3 vs. Cloudinary decision not yet made).
- No `ProjectMembership` table — per-project permission overrides are post-MVP; the RBAC doc's delegated flags (`canDeleteProjects`/`canDeleteBoards`) live directly on `WorkspaceMembership` instead.

## Exit Criteria

- [ ] Hierarchy decision (one board / many docs / one channel per project) confirmed
- [ ] `workspaceId` denormalization pattern confirmed as binding for Phase 5 implementation
- [ ] Cascade delete + message soft-delete exception confirmed
- [ ] Schema reviewed end-to-end in `schema.prisma` — flag any missing field before Phase 5 begins