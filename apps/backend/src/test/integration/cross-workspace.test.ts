import {
  setupTestDatabase,
  cleanDatabase,
  disconnectTestDatabase,
  testPrisma,
} from "../setup.js";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestProject,
  createTestInvite,
} from "../helpers.js";
import { createScopedRepository } from "../../lib/scoped-repository.js";

/**
 * Cross-workspace access test suite — Phase 5 exit criterion.
 *
 * Architecture reference: technical-risks.md Risk #4
 * "A test suite specifically attempts cross-workspace access (Workspace A's
 * authenticated user requesting Workspace B's project/doc/task IDs) and
 * asserts 403/404 across every entity type. This test suite is a Phase 5
 * exit criterion, not optional polish."
 *
 * Tests for Board, Document, Channel, Message cross-workspace access will
 * be added when those modules are built in their respective phases.
 * For Phase 5, this covers: Project (via scoped repository) and Workspace
 * (via membership check).
 */

describe("Cross-workspace access isolation (integration)", () => {
  // Test fixtures
  let userA: { id: string };
  let userB: { id: string };
  let workspaceA: { id: string };
  let workspaceB: { id: string };
  let projectA: { id: string };
  let projectB: { id: string };

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();

    // Create two isolated workspaces with their own users and projects.
    userA = await createTestUser({ id: "user-a" });
    userB = await createTestUser({ id: "user-b" });

    workspaceA = await createTestWorkspace({ slug: "workspace-a" });
    workspaceB = await createTestWorkspace({ slug: "workspace-b" });

    // User A is a member of Workspace A only.
    await createTestMembership({
      workspaceId: workspaceA.id,
      userId: userA.id,
      role: "MEMBER",
    });

    // User B is a member of Workspace B only.
    await createTestMembership({
      workspaceId: workspaceB.id,
      userId: userB.id,
      role: "MEMBER",
    });

    // Each workspace has a project.
    projectA = await createTestProject({
      workspaceId: workspaceA.id,
      createdById: userA.id,
    });
    projectB = await createTestProject({
      workspaceId: workspaceB.id,
      createdById: userB.id,
    });
  });

  // ─── Scoped Repository: Project Reads ──────────────────────────────

  describe("Scoped repository prevents cross-workspace reads", () => {
    test("User A cannot read Workspace B's project via scoped repo", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      // Attempt to read Workspace B's project through Workspace A's scoped repo.
      const result = await scopedRepo.project.findFirst({
        where: { id: projectB.id },
      });

      // Should return null — the project exists but not in this workspace.
      expect(result).toBeNull();
    });

    test("User A's scoped repo only returns Workspace A's projects", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      const projects = await scopedRepo.project.findMany();

      // Should only contain Workspace A's project.
      expect(projects).toHaveLength(1);
      expect((projects[0] as { id: string }).id).toBe(projectA.id);
    });

    test("User B cannot read Workspace A's project via scoped repo", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceB.id);

      const result = await scopedRepo.project.findFirst({
        where: { id: projectA.id },
      });

      expect(result).toBeNull();
    });
  });

  // ─── Scoped Repository: Project Updates ────────────────────────────

  describe("Scoped repository prevents cross-workspace updates", () => {
    test("User A cannot update Workspace B's project via scoped repo", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      // Attempt to update Workspace B's project through Workspace A's scoped repo.
      const result = await scopedRepo.project.update(projectB.id, {
        name: "HACKED",
      });

      // Should return null — updateMany found 0 matching records.
      expect(result).toBeNull();

      // Verify the project was NOT modified.
      const untouched = await testPrisma.project.findUnique({
        where: { id: projectB.id },
      });
      expect(untouched!.name).not.toBe("HACKED");
    });

    test("User A CAN update their own workspace's project", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      const result = await scopedRepo.project.update(projectA.id, {
        name: "Updated Name",
      });

      expect(result).not.toBeNull();
      expect((result as { name: string }).name).toBe("Updated Name");
    });
  });

  // ─── Scoped Repository: Project Deletes ────────────────────────────

  describe("Scoped repository prevents cross-workspace deletes", () => {
    test("User A cannot delete Workspace B's project via scoped repo", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      // Attempt to delete Workspace B's project through Workspace A's scoped repo.
      const result = await scopedRepo.project.delete(projectB.id);

      // Should return null — deleteMany found 0 matching records.
      expect(result).toBeNull();

      // Verify the project still exists.
      const stillExists = await testPrisma.project.findUnique({
        where: { id: projectB.id },
      });
      expect(stillExists).not.toBeNull();
    });

    test("User A CAN delete their own workspace's project", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      const result = await scopedRepo.project.delete(projectA.id);

      expect(result).toBe(true);

      // Verify the project was actually deleted.
      const deleted = await testPrisma.project.findUnique({
        where: { id: projectA.id },
      });
      expect(deleted).toBeNull();
    });
  });

  // ─── Scoped Repository: Cross-reference Attack ─────────────────────

  describe("Cross-reference attack prevention", () => {
    test("Request with Workspace A scope but Workspace B project ID returns null on read", async () => {
      // This simulates an attacker who is a member of Workspace A,
      // crafting a request that uses Workspace A's ID but guesses
      // Workspace B's project UUID.
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      const result = await scopedRepo.project.findFirst({
        where: { id: projectB.id },
      });

      expect(result).toBeNull();
    });

    test("Request with Workspace A scope but Workspace B project ID returns null on update", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      const result = await scopedRepo.project.update(projectB.id, {
        name: "CROSS_WORKSPACE_ATTACK",
      });

      expect(result).toBeNull();
    });

    test("Request with Workspace A scope but Workspace B project ID returns null on delete", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      const result = await scopedRepo.project.delete(projectB.id);

      expect(result).toBeNull();
    });
  });

  // ─── Membership Boundary ──────────────────────────────────────────

  describe("Workspace membership boundary", () => {
    test("User A has no membership in Workspace B", async () => {
      const membership = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspaceB.id,
            userId: userA.id,
          },
        },
      });

      expect(membership).toBeNull();
    });

    test("User B has no membership in Workspace A", async () => {
      const membership = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspaceA.id,
            userId: userB.id,
          },
        },
      });

      expect(membership).toBeNull();
    });
  });

  // ─── Scoped Repository: Create Isolation ───────────────────────────

  describe("Scoped repository enforces workspaceId on create", () => {
    test("Creating a project via scoped repo always sets the correct workspaceId", async () => {
      const scopedRepo = createScopedRepository(testPrisma, workspaceA.id);

      // Even if someone tried to pass a different workspaceId in the data,
      // the scoped repo overwrites it.
      const project = await scopedRepo.project.create({
        data: {
          name: "New Project",
          createdById: userA.id,
          // Note: workspaceId is omitted from the Omit<> type, but even
          // if it could be passed, the spread order ensures the scoped
          // repo's workspaceId wins.
        } as any,
      });

      expect((project as { workspaceId: string }).workspaceId).toBe(
        workspaceA.id
      );
    });
  });
});
