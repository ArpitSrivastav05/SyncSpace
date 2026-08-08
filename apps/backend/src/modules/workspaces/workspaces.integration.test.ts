import {
  setupTestDatabase,
  cleanDatabase,
  disconnectTestDatabase,
  testPrisma,
} from "../../test/setup.js";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestInvite,
} from "../../test/helpers.js";
import * as service from "./workspaces.service.js";

/**
 * Workspace service integration tests.
 *
 * Tests business logic against a real Postgres database, covering:
 * - Workspace CRUD
 * - Member management (remove, change role, transfer ownership, permissions)
 * - Invite flow (create, accept, expiry, already-member)
 * - Guardrails (last Owner, Admin can't escalate)
 */

// Override the prisma import in the service to use the test database.
// This works because the test setup overrides DATABASE_URL before the
// Prisma client singleton is created.

describe("Workspace service (integration)", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── Workspace CRUD ──────────────────────────────────────────────────

  describe("createWorkspace", () => {
    test("creates workspace with owner membership", async () => {
      const user = await createTestUser();

      const workspace = await service.createWorkspace(user, {
        name: "My Workspace",
      });

      expect(workspace.name).toBe("My Workspace");
      expect(workspace.slug).toBeTruthy();

      // Verify owner membership was created.
      const membership = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: user.id,
          },
        },
      });
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe("OWNER");
    });

    test("generates unique slug from workspace name", async () => {
      const user = await createTestUser();

      const ws1 = await service.createWorkspace(user, {
        name: "Test Workspace",
      });
      const ws2 = await service.createWorkspace(user, {
        name: "Test Workspace",
      });

      // Both should have slugs, but they should be different.
      expect(ws1.slug).toBeTruthy();
      expect(ws2.slug).toBeTruthy();
      expect(ws1.slug).not.toBe(ws2.slug);
    });
  });

  describe("listUserWorkspaces", () => {
    test("returns only workspaces user is a member of", async () => {
      const user = await createTestUser();
      const otherUser = await createTestUser();

      // Create workspaces — user is owner of ws1, not a member of ws2.
      const ws1 = await service.createWorkspace(user, { name: "WS 1" });
      await service.createWorkspace(otherUser, { name: "WS 2" });

      const workspaces = await service.listUserWorkspaces(user.id);

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]!.id).toBe(ws1.id);
    });
  });

  // ── Member Management ─────────────────────────────────────────────

  describe("removeMember", () => {
    test("removes a member from the workspace", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: member.id,
        role: "MEMBER",
      });

      await service.removeMember(workspace.id, member.id, "OWNER");

      const membership = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: member.id,
          },
        },
      });
      expect(membership).toBeNull();
    });

    test("blocks removing the last Owner", async () => {
      const owner = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });

      await expect(
        service.removeMember(workspace.id, owner.id, "OWNER")
      ).rejects.toThrow("Cannot remove the last Owner");
    });

    test("allows removing one Owner when another exists", async () => {
      const owner1 = await createTestUser();
      const owner2 = await createTestUser();
      const workspace = await service.createWorkspace(owner1, {
        name: "WS",
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: owner2.id,
        role: "OWNER",
      });

      // Should succeed — there are two owners.
      await service.removeMember(workspace.id, owner2.id, "OWNER");

      const membership = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: owner2.id,
          },
        },
      });
      expect(membership).toBeNull();
    });
  });

  describe("changeRole", () => {
    test("changes a member's role", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: member.id,
        role: "MEMBER",
      });

      await service.changeRole(workspace.id, member.id, "ADMIN", {
        userId: owner.id,
        role: "OWNER",
      });

      const updated = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: member.id,
          },
        },
      });
      expect(updated!.role).toBe("ADMIN");
    });

    test("blocks demoting the last Owner", async () => {
      const owner = await createTestUser();
      const admin = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: admin.id,
        role: "ADMIN",
      });

      await expect(
        service.changeRole(workspace.id, owner.id, "ADMIN", {
          userId: admin.id,
          // Verifies the guardrail as a defense-in-depth safety net; not currently reachable via
          // the authenticated route given the self-role-change and Owner-only restrictions.
          role: "OWNER",
        })
      ).rejects.toThrow("Cannot demote the last Owner");
    });

    test("blocks changing your own role", async () => {
      const owner = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });

      await expect(
        service.changeRole(workspace.id, owner.id, "ADMIN", {
          userId: owner.id,
          role: "OWNER",
        })
      ).rejects.toThrow("Cannot change your own role");
    });
  });

  describe("transferOwnership", () => {
    test("grants OWNER role to target member", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: member.id,
        role: "MEMBER",
      });

      await service.transferOwnership(workspace.id, member.id);

      const updated = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: member.id,
          },
        },
      });
      expect(updated!.role).toBe("OWNER");
    });

    test("rejects if target is already an Owner", async () => {
      const owner1 = await createTestUser();
      const owner2 = await createTestUser();
      const workspace = await service.createWorkspace(owner1, {
        name: "WS",
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: owner2.id,
        role: "OWNER",
      });

      await expect(
        service.transferOwnership(workspace.id, owner2.id)
      ).rejects.toThrow("already an Owner");
    });
  });

  describe("updateMemberPermissions", () => {
    test("grants canDeleteProjects to a member", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: member.id,
        role: "MEMBER",
      });

      await service.updateMemberPermissions(workspace.id, member.id, {
        canDeleteProjects: true,
      });

      const updated = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: member.id,
          },
        },
      });
      expect(updated!.canDeleteProjects).toBe(true);
      expect(updated!.canDeleteBoards).toBe(false); // unchanged
    });
  });

  // ── Invite Flow ───────────────────────────────────────────────────

  describe("Invite management", () => {
    test("createInvite generates a token with expiry", async () => {
      const owner = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });

      const invite = await service.createInvite(workspace.id, owner.id, {
        email: "newuser@example.com",
      });

      expect(invite.token).toBeTruthy();
      expect(invite.token.length).toBeGreaterThanOrEqual(32);
      expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(invite.role).toBe("MEMBER");
    });

    test("acceptInvite creates membership and marks invite accepted", async () => {
      const owner = await createTestUser();
      const newUser = await createTestUser({
        email: "newuser@example.com",
      });
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      const invite = await service.createInvite(workspace.id, owner.id, {
        email: newUser.email,
      });

      const result = await service.acceptInvite(invite.token, newUser);

      expect(result.id).toBe(workspace.id);

      // Verify membership was created.
      const membership = await testPrisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: newUser.id,
          },
        },
      });
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe("MEMBER");

      // Verify invite was marked as accepted.
      const updatedInvite = await testPrisma.workspaceInvite.findUnique({
        where: { id: invite.id },
      });
      expect(updatedInvite!.acceptedAt).not.toBeNull();
    });

    test("acceptInvite rejects expired invite", async () => {
      const owner = await createTestUser();
      const newUser = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      const invite = await createTestInvite({
        workspaceId: workspace.id,
        invitedById: owner.id,
        expiresAt: new Date(Date.now() - 1000), // already expired
      });

      await expect(
        service.acceptInvite(invite.token, newUser)
      ).rejects.toThrow("expired");
    });

    test("acceptInvite rejects if accepting user email does not match invite email", async () => {
      const owner = await createTestUser();
      const maliciousUser = await createTestUser({ email: "attacker@example.com" });
      const workspace = await service.createWorkspace(owner, { name: "WS" });
      
      const invite = await service.createInvite(workspace.id, owner.id, {
        email: "target@example.com",
      });

      await expect(
        service.acceptInvite(invite.token, maliciousUser)
      ).rejects.toThrow("sent to a different email address");
    });

    test("acceptInvite rejects already-accepted invite", async () => {
      const owner = await createTestUser();
      const user1 = await createTestUser();
      const user2 = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      const invite = await service.createInvite(workspace.id, owner.id, {
        email: user1.email,
      });

      // First acceptance succeeds.
      await service.acceptInvite(invite.token, user1);

      // Second acceptance should fail.
      await expect(
        service.acceptInvite(invite.token, user2)
      ).rejects.toThrow("already been accepted");
    });

    test("acceptInvite rejects if user is already a member", async () => {
      const owner = await createTestUser();
      const workspace = await service.createWorkspace(owner, {
        name: "WS",
      });
      const invite = await service.createInvite(workspace.id, owner.id, {
        email: owner.email,
      });

      // Owner is already a member.
      await expect(
        service.acceptInvite(invite.token, owner)
      ).rejects.toThrow("already a member");
    });
  });
});
