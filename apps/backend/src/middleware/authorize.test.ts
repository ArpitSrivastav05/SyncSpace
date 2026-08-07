import { can, type Action, type AuthorizationContext } from "./authorize.js";

/**
 * RBAC authorization helper test suite.
 *
 * Architecture reference: RBAC doc §Enforcement Pattern
 * "This matrix IS the spec for that helper's test suite — each row above
 * becomes a test case (role × action → allow/deny), so the matrix and
 * the code can't silently drift apart."
 *
 * Every row of the permission matrix from rbac-permission-matrix.md is
 * covered here. This is not optional coverage — it's the contractual
 * guarantee that the code matches the spec.
 */

// ─── Test Helpers ─────────────────────────────────────────────────────

function membershipOf(
  role: "OWNER" | "ADMIN" | "MEMBER",
  overrides: {
    userId?: string;
    canDeleteProjects?: boolean;
    canDeleteBoards?: boolean;
  } = {}
): AuthorizationContext["membership"] {
  return {
    userId: overrides.userId ?? "user-1",
    role,
    canDeleteProjects: overrides.canDeleteProjects ?? false,
    canDeleteBoards: overrides.canDeleteBoards ?? false,
  };
}

function expectAllow(
  action: Action,
  context: AuthorizationContext,
  description?: string
): void {
  expect(can(action, context)).toBe(true);
}

function expectDeny(
  action: Action,
  context: AuthorizationContext,
  description?: string
): void {
  expect(can(action, context)).toBe(false);
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("can() authorization helper", () => {
  // ── Workspace Actions ───────────────────────────────────────────────

  describe("Workspace actions", () => {
    test("Owner can view workspace settings", () => {
      expectAllow("workspace:view_settings", {
        membership: membershipOf("OWNER"),
      });
    });

    test("Admin can view workspace settings", () => {
      expectAllow("workspace:view_settings", {
        membership: membershipOf("ADMIN"),
      });
    });

    test("Member can view workspace settings", () => {
      expectAllow("workspace:view_settings", {
        membership: membershipOf("MEMBER"),
      });
    });

    test("Owner can update workspace settings", () => {
      expectAllow("workspace:update_settings", {
        membership: membershipOf("OWNER"),
      });
    });

    test("Admin can update workspace settings", () => {
      expectAllow("workspace:update_settings", {
        membership: membershipOf("ADMIN"),
      });
    });

    test("Member cannot update workspace settings", () => {
      expectDeny("workspace:update_settings", {
        membership: membershipOf("MEMBER"),
      });
    });

    test("Owner can delete workspace", () => {
      expectAllow("workspace:delete", {
        membership: membershipOf("OWNER"),
      });
    });

    test("Admin cannot delete workspace", () => {
      expectDeny("workspace:delete", {
        membership: membershipOf("ADMIN"),
      });
    });

    test("Member cannot delete workspace", () => {
      expectDeny("workspace:delete", {
        membership: membershipOf("MEMBER"),
      });
    });
  });

  // ── Member Management ───────────────────────────────────────────────

  describe("Member management", () => {
    // View members
    test("Owner can view member list", () => {
      expectAllow("member:view", { membership: membershipOf("OWNER") });
    });

    test("Admin can view member list", () => {
      expectAllow("member:view", { membership: membershipOf("ADMIN") });
    });

    test("Member can view member list", () => {
      expectAllow("member:view", { membership: membershipOf("MEMBER") });
    });

    // Invite
    test("Owner can invite new members", () => {
      expectAllow("member:invite", { membership: membershipOf("OWNER") });
    });

    test("Admin can invite new members", () => {
      expectAllow("member:invite", { membership: membershipOf("ADMIN") });
    });

    test("Member cannot invite new members", () => {
      expectDeny("member:invite", { membership: membershipOf("MEMBER") });
    });

    // Remove
    test("Owner can remove any member", () => {
      expectAllow("member:remove", {
        membership: membershipOf("OWNER"),
        resource: { targetMembership: { userId: "target", role: "MEMBER" } },
      });
      expectAllow("member:remove", {
        membership: membershipOf("OWNER"),
        resource: { targetMembership: { userId: "target", role: "ADMIN" } },
      });
      expectAllow("member:remove", {
        membership: membershipOf("OWNER"),
        resource: { targetMembership: { userId: "target", role: "OWNER" } },
      });
    });

    test("Admin can remove a Member", () => {
      expectAllow("member:remove", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "target", role: "MEMBER" } },
      });
    });

    test("Admin can remove another Admin", () => {
      expectAllow("member:remove", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "target", role: "ADMIN" } },
      });
    });

    test("Admin cannot remove an Owner", () => {
      expectDeny("member:remove", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "target", role: "OWNER" } },
      });
    });

    test("Member cannot remove anyone", () => {
      expectDeny("member:remove", {
        membership: membershipOf("MEMBER"),
        resource: { targetMembership: { userId: "target", role: "MEMBER" } },
      });
    });

    // Change role
    test("Owner can change any role", () => {
      expectAllow("member:change_role", {
        membership: membershipOf("OWNER"),
        resource: { targetMembership: { userId: "target", role: "MEMBER" } },
      });
      expectAllow("member:change_role", {
        membership: membershipOf("OWNER"),
        resource: { targetMembership: { userId: "target", role: "ADMIN" } },
      });
      expectAllow("member:change_role", {
        membership: membershipOf("OWNER"),
        resource: { targetMembership: { userId: "target", role: "OWNER" } },
      });
    });

    test("Admin can change Member↔Admin", () => {
      expectAllow("member:change_role", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "target", role: "MEMBER" } },
      });
      expectAllow("member:change_role", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "target", role: "ADMIN" } },
      });
    });

    test("Admin cannot change Owner role", () => {
      expectDeny("member:change_role", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "target", role: "OWNER" } },
      });
    });

    test("Member cannot change roles", () => {
      expectDeny("member:change_role", {
        membership: membershipOf("MEMBER"),
        resource: { targetMembership: { userId: "target", role: "MEMBER" } },
      });
    });

    // Transfer ownership
    test("Owner can transfer ownership", () => {
      expectAllow("member:transfer_ownership", {
        membership: membershipOf("OWNER"),
      });
    });

    test("Admin cannot transfer ownership", () => {
      expectDeny("member:transfer_ownership", {
        membership: membershipOf("ADMIN"),
      });
    });

    test("Member cannot transfer ownership", () => {
      expectDeny("member:transfer_ownership", {
        membership: membershipOf("MEMBER"),
      });
    });

    // Grant delete permissions
    test("Owner can grant delete permissions", () => {
      expectAllow("member:grant_delete_permission", {
        membership: membershipOf("OWNER"),
      });
    });

    test("Admin can grant delete permissions", () => {
      expectAllow("member:grant_delete_permission", {
        membership: membershipOf("ADMIN"),
      });
    });

    test("Member cannot grant delete permissions", () => {
      expectDeny("member:grant_delete_permission", {
        membership: membershipOf("MEMBER"),
      });
    });
  });

  // ── Project Actions ─────────────────────────────────────────────────

  describe("Project actions", () => {
    test("All roles can create projects", () => {
      expectAllow("project:create", { membership: membershipOf("OWNER") });
      expectAllow("project:create", { membership: membershipOf("ADMIN") });
      expectAllow("project:create", { membership: membershipOf("MEMBER") });
    });

    test("All roles can view projects", () => {
      expectAllow("project:view", { membership: membershipOf("OWNER") });
      expectAllow("project:view", { membership: membershipOf("ADMIN") });
      expectAllow("project:view", { membership: membershipOf("MEMBER") });
    });

    test("Owner can update any project", () => {
      expectAllow("project:update", {
        membership: membershipOf("OWNER"),
        resource: { createdById: "other-user" },
      });
    });

    test("Admin can update any project", () => {
      expectAllow("project:update", {
        membership: membershipOf("ADMIN"),
        resource: { createdById: "other-user" },
      });
    });

    test("Member can update own project", () => {
      expectAllow("project:update", {
        membership: membershipOf("MEMBER", { userId: "user-1" }),
        resource: { createdById: "user-1" },
      });
    });

    test("Member cannot update others' project", () => {
      expectDeny("project:update", {
        membership: membershipOf("MEMBER", { userId: "user-1" }),
        resource: { createdById: "other-user" },
      });
    });

    test("Owner can delete any project", () => {
      expectAllow("project:delete", { membership: membershipOf("OWNER") });
    });

    test("Admin can delete any project", () => {
      expectAllow("project:delete", { membership: membershipOf("ADMIN") });
    });

    test("Member with canDeleteProjects can delete", () => {
      expectAllow("project:delete", {
        membership: membershipOf("MEMBER", { canDeleteProjects: true }),
      });
    });

    test("Member without canDeleteProjects cannot delete", () => {
      expectDeny("project:delete", {
        membership: membershipOf("MEMBER", { canDeleteProjects: false }),
      });
    });
  });

  // ── Board & Task Actions ────────────────────────────────────────────

  describe("Board & Task actions", () => {
    test("All roles can create boards", () => {
      expectAllow("board:create", { membership: membershipOf("OWNER") });
      expectAllow("board:create", { membership: membershipOf("ADMIN") });
      expectAllow("board:create", { membership: membershipOf("MEMBER") });
    });

    test("All roles can view boards", () => {
      expectAllow("board:view", { membership: membershipOf("OWNER") });
      expectAllow("board:view", { membership: membershipOf("ADMIN") });
      expectAllow("board:view", { membership: membershipOf("MEMBER") });
    });

    test("Owner can delete board", () => {
      expectAllow("board:delete", { membership: membershipOf("OWNER") });
    });

    test("Admin can delete board", () => {
      expectAllow("board:delete", { membership: membershipOf("ADMIN") });
    });

    test("Member with canDeleteBoards can delete board", () => {
      expectAllow("board:delete", {
        membership: membershipOf("MEMBER", { canDeleteBoards: true }),
      });
    });

    test("Member without canDeleteBoards cannot delete board", () => {
      expectDeny("board:delete", {
        membership: membershipOf("MEMBER", { canDeleteBoards: false }),
      });
    });

    test("All roles can create, edit, and assign tasks", () => {
      for (const action of [
        "task:create",
        "task:edit",
        "task:assign",
      ] as Action[]) {
        expectAllow(action, { membership: membershipOf("OWNER") });
        expectAllow(action, { membership: membershipOf("ADMIN") });
        expectAllow(action, { membership: membershipOf("MEMBER") });
      }
    });
  });

  // ── Document Actions ────────────────────────────────────────────────

  describe("Document actions", () => {
    test("All roles can create documents", () => {
      expectAllow("document:create", { membership: membershipOf("OWNER") });
      expectAllow("document:create", { membership: membershipOf("ADMIN") });
      expectAllow("document:create", { membership: membershipOf("MEMBER") });
    });

    test("All roles can edit documents (real-time)", () => {
      expectAllow("document:edit", { membership: membershipOf("OWNER") });
      expectAllow("document:edit", { membership: membershipOf("ADMIN") });
      expectAllow("document:edit", { membership: membershipOf("MEMBER") });
    });

    test("All roles can view version history", () => {
      expectAllow("document:view_history", {
        membership: membershipOf("OWNER"),
      });
      expectAllow("document:view_history", {
        membership: membershipOf("ADMIN"),
      });
      expectAllow("document:view_history", {
        membership: membershipOf("MEMBER"),
      });
    });

    test("Owner can delete document", () => {
      expectAllow("document:delete", { membership: membershipOf("OWNER") });
    });

    test("Admin can delete document", () => {
      expectAllow("document:delete", { membership: membershipOf("ADMIN") });
    });

    test("Member cannot delete document", () => {
      expectDeny("document:delete", { membership: membershipOf("MEMBER") });
    });
  });

  // ── Channel & Message Actions ───────────────────────────────────────

  describe("Channel & Message actions", () => {
    test("All roles can create channels", () => {
      expectAllow("channel:create", { membership: membershipOf("OWNER") });
      expectAllow("channel:create", { membership: membershipOf("ADMIN") });
      expectAllow("channel:create", { membership: membershipOf("MEMBER") });
    });

    test("Owner can delete channel", () => {
      expectAllow("channel:delete", { membership: membershipOf("OWNER") });
    });

    test("Admin can delete channel", () => {
      expectAllow("channel:delete", { membership: membershipOf("ADMIN") });
    });

    test("Member cannot delete channel", () => {
      expectDeny("channel:delete", { membership: membershipOf("MEMBER") });
    });

    test("All roles can post messages", () => {
      expectAllow("message:post", { membership: membershipOf("OWNER") });
      expectAllow("message:post", { membership: membershipOf("ADMIN") });
      expectAllow("message:post", { membership: membershipOf("MEMBER") });
    });

    test("All roles can edit own messages", () => {
      expectAllow("message:edit_own", { membership: membershipOf("OWNER") });
      expectAllow("message:edit_own", { membership: membershipOf("ADMIN") });
      expectAllow("message:edit_own", { membership: membershipOf("MEMBER") });
    });

    test("All roles can delete own messages", () => {
      expectAllow("message:delete_own", { membership: membershipOf("OWNER") });
      expectAllow("message:delete_own", {
        membership: membershipOf("ADMIN"),
      });
      expectAllow("message:delete_own", {
        membership: membershipOf("MEMBER"),
      });
    });

    test("Owner can moderate (delete others' messages)", () => {
      expectAllow("message:moderate", { membership: membershipOf("OWNER") });
    });

    test("Admin can moderate (delete others' messages)", () => {
      expectAllow("message:moderate", { membership: membershipOf("ADMIN") });
    });

    test("Member cannot moderate", () => {
      expectDeny("message:moderate", { membership: membershipOf("MEMBER") });
    });
  });

  // ── AI Actions ──────────────────────────────────────────────────────

  describe("AI actions", () => {
    test("All roles can use AI features", () => {
      expectAllow("ai:use", { membership: membershipOf("OWNER") });
      expectAllow("ai:use", { membership: membershipOf("ADMIN") });
      expectAllow("ai:use", { membership: membershipOf("MEMBER") });
    });
  });

  // ── Edge Cases & Guardrails ─────────────────────────────────────────

  describe("Guardrails", () => {
    test("Admin cannot remove Owner (prevents privilege escalation)", () => {
      expectDeny("member:remove", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "owner", role: "OWNER" } },
      });
    });

    test("Admin cannot change Owner's role (prevents escalation)", () => {
      expectDeny("member:change_role", {
        membership: membershipOf("ADMIN"),
        resource: { targetMembership: { userId: "owner", role: "OWNER" } },
      });
    });

    test("Admin cannot promote someone to Owner (prevents privilege escalation)", () => {
      expectDeny("member:change_role", {
        membership: membershipOf("ADMIN"),
        resource: { 
          targetMembership: { userId: "member", role: "MEMBER" },
          newRole: "OWNER"
        },
      });
    });

    test("Admin cannot invite an Owner (prevents privilege escalation)", () => {
      expectDeny("member:invite", {
        membership: membershipOf("ADMIN"),
        resource: { newRole: "OWNER" },
      });
    });

    test("Member:remove without target context returns false", () => {
      // Missing targetMembership — should deny for safety.
      expectDeny("member:remove", {
        membership: membershipOf("ADMIN"),
      });
    });

    test("Member:change_role without target context returns false", () => {
      expectDeny("member:change_role", {
        membership: membershipOf("ADMIN"),
      });
    });

    test("Member project:update without createdById denies (no context = no access)", () => {
      // Member with no resource context — createdById is undefined,
      // so userId !== undefined → denied.
      expectDeny("project:update", {
        membership: membershipOf("MEMBER"),
      });
    });
  });
});
