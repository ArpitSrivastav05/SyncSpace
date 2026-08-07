import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Tenant-scoping repository factory.
 *
 * Architecture reference: technical-risks.md Risk #4
 * "All reads/writes go through a shared repository helper that injects
 * workspaceId from the authenticated session automatically — individual
 * route handlers must not be trusted to remember to filter by workspace
 * manually."
 *
 * Every method auto-injects `workspaceId` into the query. This removes
 * the "forgot the where clause" failure mode entirely.
 *
 * IMPORTANT implementation notes:
 * - Reads use `findFirst` (not `findUnique`) because Prisma's `findUnique`
 *   only accepts unique fields in `where` — we can't add `workspaceId`
 *   alongside `id` since it's not a compound unique key.
 * - Updates use `updateMany` (not `update`) for the same reason —
 *   `update` requires unique where, `updateMany` accepts arbitrary filters.
 *   We check the returned count: 0 means "doesn't exist or wrong tenant" → null.
 * - Deletes use `deleteMany` (not `delete`) with the same count-check pattern.
 * - The caller never learns whether an ID exists in another workspace —
 *   "not found" and "belongs to another tenant" are indistinguishable.
 */

export interface ScopedRepository {
  readonly workspaceId: string;
  readonly project: ScopedModelRepository<
    Prisma.ProjectWhereInput,
    Prisma.ProjectCreateInput,
    Prisma.ProjectUpdateManyMutationInput,
    Prisma.ProjectInclude
  >;
  readonly board: ScopedModelRepository<
    Prisma.BoardWhereInput,
    Prisma.BoardCreateInput,
    Prisma.BoardUpdateManyMutationInput,
    Prisma.BoardInclude
  >;
  readonly task: ScopedModelRepository<
    Prisma.TaskWhereInput,
    Prisma.TaskCreateInput,
    Prisma.TaskUpdateManyMutationInput,
    Prisma.TaskInclude
  >;
  readonly document: ScopedModelRepository<
    Prisma.DocumentWhereInput,
    Prisma.DocumentCreateInput,
    Prisma.DocumentUpdateManyMutationInput,
    Prisma.DocumentInclude
  >;
  readonly channel: ScopedModelRepository<
    Prisma.ChannelWhereInput,
    Prisma.ChannelCreateInput,
    Prisma.ChannelUpdateManyMutationInput,
    Prisma.ChannelInclude
  >;
  readonly message: ScopedModelRepository<
    Prisma.MessageWhereInput,
    Prisma.MessageCreateInput,
    Prisma.MessageUpdateManyMutationInput,
    Prisma.MessageInclude
  >;
  readonly notification: ScopedModelRepository<
    Prisma.NotificationWhereInput,
    Prisma.NotificationCreateInput,
    Prisma.NotificationUpdateManyMutationInput,
    Prisma.NotificationInclude
  >;
}

export interface ScopedModelRepository<TWhere, TCreate, TUpdate, TInclude> {
  findMany(args?: {
    where?: TWhere;
    include?: TInclude;
    orderBy?: unknown;
    skip?: number;
    take?: number;
  }): Promise<unknown[]>;

  findFirst(args?: {
    where?: TWhere;
    include?: TInclude;
  }): Promise<unknown | null>;

  create(args: {
    data: Omit<TCreate, "workspaceId">;
    include?: TInclude;
  }): Promise<unknown>;

  /** Returns the updated record, or null if not found / wrong tenant. */
  update(id: string, data: TUpdate): Promise<unknown | null>;

  /** Returns true if deleted, or null if not found / wrong tenant. */
  delete(id: string): Promise<true | null>;
}

/**
 * Creates a tenant-scoped repository instance.
 *
 * @param prisma - The Prisma client instance
 * @param workspaceId - The workspace ID to scope all queries to
 */
export function createScopedRepository(
  prisma: PrismaClient,
  workspaceId: string
): ScopedRepository {
  return {
    workspaceId,

    project: createScopedModel(prisma, "project", workspaceId),
    board: createScopedModel(prisma, "board", workspaceId),
    task: createScopedModel(prisma, "task", workspaceId),
    document: createScopedModel(prisma, "document", workspaceId),
    channel: createScopedModel(prisma, "channel", workspaceId),
    message: createScopedModel(prisma, "message", workspaceId),
    notification: createScopedModel(prisma, "notification", workspaceId),
  };
}

// The set of Prisma model names that carry a denormalized workspaceId.
type ScopedModelName =
  | "project"
  | "board"
  | "task"
  | "document"
  | "channel"
  | "message"
  | "notification";

/**
 * Internal factory that creates the scoped CRUD methods for a single model.
 *
 * Uses Prisma's dynamic model access (`prisma[modelName]`) to avoid
 * duplicating the same pattern seven times.
 */
function createScopedModel(
  prisma: PrismaClient,
  modelName: ScopedModelName,
  workspaceId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ScopedModelRepository<any, any, any, any> {
  // Prisma's dynamic model access — safe because modelName is a
  // constrained union, not user input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[modelName];

  return {
    async findMany(args) {
      return model.findMany({
        ...args,
        where: { ...args?.where, workspaceId },
      });
    },

    async findFirst(args) {
      return model.findFirst({
        ...args,
        where: { ...args?.where, workspaceId },
      });
    },

    async create(args) {
      return model.create({
        ...args,
        data: { ...args.data, workspaceId },
      });
    },

    async update(id: string, data) {
      // updateMany accepts arbitrary where filters (unlike update which
      // requires a unique field). The { id, workspaceId } combo ensures
      // we never mutate a record belonging to another tenant.
      const result = await model.updateMany({
        where: { id, workspaceId },
        data,
      });
      if (result.count === 0) return null;
      // Re-fetch to return the updated record (updateMany doesn't return it).
      // This adds one extra query per mutation — acceptable trade-off for
      // correctness at this project's scale.
      return model.findFirst({ where: { id, workspaceId } });
    },

    async delete(id: string) {
      // deleteMany with { id, workspaceId } — same pattern as update.
      // count === 0 means "doesn't exist or belongs to another tenant."
      const result = await model.deleteMany({
        where: { id, workspaceId },
      });
      if (result.count === 0) return null;
      return true;
    },
  };
}
