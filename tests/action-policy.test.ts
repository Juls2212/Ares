import { describe, expect, it } from "vitest";
import {
  ACTION_NAMES,
  type ActionName,
  type ActionRiskLevel
} from "../src/shared/action-contracts";
import {
  evaluateActionProposal,
  getActionPolicy,
  requiresActionConfirmation
} from "../src/main/actions/action-policy";

const expectedRiskLevels: Record<ActionName, ActionRiskLevel> = {
  OPEN_APPLICATION: 1,
  CREATE_FOLDER: 2,
  RENAME_FILE: 2,
  RENAME_FOLDER: 2,
  MOVE_FILE: 2,
  SEARCH_FILES: 1,
  ORGANIZE_FILES: 2,
  CREATE_TASK: 1,
  UPDATE_TASK: 2,
  COMPLETE_TASK: 2,
  CREATE_EVENT: 1,
  UPDATE_EVENT: 2,
  CREATE_REMINDER: 1,
  GET_TODAY_SCHEDULE: 1,
  GET_WEEK_SCHEDULE: 1
};

describe("action policy", () => {
  it("contains the complete approved MVP action catalog", () => {
    expect(ACTION_NAMES).toEqual([
      "OPEN_APPLICATION",
      "CREATE_FOLDER",
      "RENAME_FILE",
      "RENAME_FOLDER",
      "MOVE_FILE",
      "SEARCH_FILES",
      "ORGANIZE_FILES",
      "CREATE_TASK",
      "UPDATE_TASK",
      "COMPLETE_TASK",
      "CREATE_EVENT",
      "UPDATE_EVENT",
      "CREATE_REMINDER",
      "GET_TODAY_SCHEDULE",
      "GET_WEEK_SCHEDULE"
    ]);
  });

  it("uses the approved risk and confirmation rules for every action", () => {
    for (const action of ACTION_NAMES) {
      const policy = getActionPolicy(action);
      expect(policy.riskLevel).toBe(expectedRiskLevels[action]);
      expect(policy.confirmation.required).toBe(policy.riskLevel === 2);
      expect(policy.confirmation.summary).toMatch(/^[A-ZÁÉÍÓÚÑ¿¡]/u);
      expect(policy.confirmation.summary).not.toMatch(/postgres|token|password|c:\\|\//iu);
    }
  });

  it("marks implemented planner, application, and approved file actions as available", () => {
    expect(getActionPolicy("CREATE_TASK").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("GET_WEEK_SCHEDULE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("OPEN_APPLICATION").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("SEARCH_FILES").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("CREATE_FOLDER").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("RENAME_FILE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("RENAME_FOLDER").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("MOVE_FILE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("ORGANIZE_FILES").availability).toBe("IMPLEMENTED");
  });

  it("rejects unknown proposals without executing them", () => {
    const unknown = evaluateActionProposal({
      action: "DELETE_FILE",
      command: "Remove-Item C:\\private"
    });

    expect(unknown).toEqual({
      ok: false,
      error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo realizar esa acción." }
    });
    expect(JSON.stringify(unknown)).not.toContain("Remove-Item");
  });

  it("keeps planner proposal payloads typed and applies confirmation only to Level 2 actions", () => {
    const createTask = { actionId: "proposal-1", action: "CREATE_TASK" as const, input: { title: "Plan review" } };
    const completeTask = {
      actionId: "proposal-2",
      action: "COMPLETE_TASK" as const,
      input: { taskId: "550e8400-e29b-41d4-a716-446655440000", completedAt: "2026-09-17T12:00:00Z" }
    };

    expect(requiresActionConfirmation(createTask)).toBe(false);
    expect(requiresActionConfirmation(completeTask)).toBe(true);
  });

  it("defines OPEN_APPLICATION with an alias-only structured payload", () => {
    const proposal = {
      actionId: "proposal-3",
      action: "OPEN_APPLICATION" as const,
      input: { alias: "Word" }
    };

    expect(requiresActionConfirmation(proposal)).toBe(false);
    expect(evaluateActionProposal(proposal)).toMatchObject({
      ok: true,
      data: { action: "OPEN_APPLICATION", riskLevel: 1, availability: "IMPLEMENTED" }
    });
  });

  it("keeps SEARCH_FILES at Level 1 and each single-item mutation at Level 2", () => {
    expect(requiresActionConfirmation({
      actionId: "proposal-4",
      action: "SEARCH_FILES",
      input: { rootId: "DOCUMENTS", query: "report" }
    })).toBe(false);
    expect(requiresActionConfirmation({
      actionId: "proposal-5",
      action: "CREATE_FOLDER",
      input: { parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" }, name: "Archive" }
    })).toBe(true);
    expect(requiresActionConfirmation({
      actionId: "proposal-6",
      action: "ORGANIZE_FILES",
      input: { folder: { rootId: "DOCUMENTS", relativePath: "Inbox" } }
    })).toBe(true);
  });
});
