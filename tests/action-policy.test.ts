import { describe, expect, it } from "vitest";
import {
  ACTION_KINDS,
  ACTION_NAMES,
  type ActionApprovalClass,
  type ActionKind,
  type ActionRiskLevel
} from "../src/shared/action-contracts";
import {
  evaluateActionProposal,
  getActionPolicy,
  lookupActionPolicy,
  requiresActionConfirmation
} from "../src/main/actions/action-policy";

const expectedRiskLevels: Record<ActionKind, ActionRiskLevel> = {
  OPEN_APPLICATION: 1,
  OPEN_WEB_PAGE: 1,
  CREATE_FOLDER: 1,
  RENAME_FILE: 2,
  RENAME_FOLDER: 2,
  MOVE_FILE: 2,
  SEARCH_FILES: 1,
  ORGANIZE_FILES: 2,
  CREATE_TASK: 1,
  UPDATE_TASK: 1,
  COMPLETE_TASK: 1,
  CREATE_EVENT: 1,
  UPDATE_EVENT: 1,
  CREATE_REMINDER: 1,
  GET_TODAY_SCHEDULE: 1,
  GET_WEEK_SCHEDULE: 1,
  GET_WEEKLY_SCHEDULE_DETAILS: 1,
  ANALYZE_WEEKLY_SCHEDULE: 1,
  GET_TODAY_AVAILABILITY: 1,
  GET_CURRENT_DATE_TIME: 1,
  GET_WEATHER: 1,
  OPEN_REGISTERED_APPLICATION: 1,
  OPEN_REGISTERED_PAGE: 1,
  MOVE_FOLDER: 2,
  UPDATE_REGISTERED_APPLICATION: 2,
  UPDATE_REGISTERED_PAGE: 2,
  DELETE_EVENT: 3,
  DELETE_TASK: 3,
  DELETE_FILE: 3,
  DELETE_FOLDER: 3
};

const approvalByRisk: Record<ActionRiskLevel, ActionApprovalClass> = {
  1: "DIRECT",
  2: "CONFIRMATION_REQUIRED",
  3: "REINFORCED_CONFIRMATION_REQUIRED"
};

describe("action policy", () => {
  it("contains the complete approved MVP action catalog", () => {
    expect(ACTION_KINDS).toEqual([
      "OPEN_APPLICATION",
      "OPEN_WEB_PAGE",
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
      "GET_WEEK_SCHEDULE",
      "GET_WEEKLY_SCHEDULE_DETAILS",
      "ANALYZE_WEEKLY_SCHEDULE",
      "GET_TODAY_AVAILABILITY",
      "GET_CURRENT_DATE_TIME",
      "GET_WEATHER",
      "DELETE_EVENT",
      "DELETE_TASK",
      "OPEN_REGISTERED_APPLICATION",
      "OPEN_REGISTERED_PAGE",
      "MOVE_FOLDER",
      "UPDATE_REGISTERED_APPLICATION",
      "UPDATE_REGISTERED_PAGE",
      "DELETE_FILE",
      "DELETE_FOLDER"
    ]);
  });

  it("uses the approved risk and confirmation rules for every action", () => {
    expect(ACTION_NAMES).toEqual(ACTION_KINDS.slice(0, ACTION_NAMES.length));
    for (const action of ACTION_KINDS) {
      const policy = getActionPolicy(action);
      expect(policy.riskLevel).toBe(expectedRiskLevels[action]);
      expect(policy.approval).toBe(approvalByRisk[expectedRiskLevels[action]]);
      expect(policy.confirmation.required).toBe(policy.approval !== "DIRECT");
      expect(policy.confirmation.summary).toMatch(/^[A-ZÁÉÍÓÚÑ¿¡]/u);
      expect(policy.confirmation.summary).not.toMatch(/postgres|token|password|c:\\|\//iu);
    }
  });

  it("marks implemented planner, application, and approved file actions as available", () => {
    expect(getActionPolicy("CREATE_TASK").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("GET_WEEK_SCHEDULE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("GET_WEEKLY_SCHEDULE_DETAILS").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("ANALYZE_WEEKLY_SCHEDULE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("GET_TODAY_AVAILABILITY").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("OPEN_APPLICATION").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("OPEN_WEB_PAGE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("SEARCH_FILES").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("CREATE_FOLDER").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("RENAME_FILE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("RENAME_FOLDER").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("MOVE_FILE").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("ORGANIZE_FILES").availability).toBe("IMPLEMENTED");
  });

  it("rejects unknown proposals without executing them", () => {
    const unknown = evaluateActionProposal({
      action: "RUN_SHELL",
      command: "Remove-Item C:\\private"
    });

    expect(unknown).toEqual({
      ok: false,
      error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo realizar esa acción." }
    });
    expect(JSON.stringify(unknown)).not.toContain("Remove-Item");
    expect(lookupActionPolicy("RUN_SHELL")).toEqual(unknown);
    expect(evaluateActionProposal({ action: "DELETE_FILE" })).toMatchObject({
      ok: false,
      error: { code: "ACTION_DEFERRED" }
    });
  });

  it("keeps planner proposal payloads typed and makes routine updates direct", () => {
    const createTask = { actionId: "proposal-1", action: "CREATE_TASK" as const, input: { title: "Plan review" } };
    const completeTask = {
      actionId: "proposal-2",
      action: "COMPLETE_TASK" as const,
      input: { taskId: "550e8400-e29b-41d4-a716-446655440000", completedAt: "2026-09-17T12:00:00Z" }
    };

    expect(requiresActionConfirmation(createTask)).toBe(false);
    expect(requiresActionConfirmation(completeTask)).toBe(false);
    expect(requiresActionConfirmation({ actionId: "proposal-7", action: "GET_WEEKLY_SCHEDULE_DETAILS", input: { scheduleTitle: "Universidad" } })).toBe(false);
    expect(requiresActionConfirmation({ actionId: "proposal-8", action: "ANALYZE_WEEKLY_SCHEDULE", input: { scheduleTitle: "Universidad", analysis: "OVERLAPS" } })).toBe(false);
    expect(requiresActionConfirmation({ actionId: "proposal-9", action: "GET_TODAY_AVAILABILITY", input: {} })).toBe(false);
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

  it("keeps searches and folder creation direct while file changes require confirmation", () => {
    expect(requiresActionConfirmation({
      actionId: "proposal-4",
      action: "SEARCH_FILES",
      input: { rootId: "DOCUMENTS", query: "report" }
    })).toBe(false);
    expect(requiresActionConfirmation({
      actionId: "proposal-5",
      action: "CREATE_FOLDER",
      input: { parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" }, name: "Archive" }
    })).toBe(false);
    expect(requiresActionConfirmation({
      actionId: "proposal-6",
      action: "ORGANIZE_FILES",
      input: { folder: { rootId: "DOCUMENTS", relativePath: "Inbox" } }
    })).toBe(true);
  });

  it("never classifies destructive actions as direct", () => {
    for (const action of ["DELETE_EVENT", "DELETE_FILE", "DELETE_FOLDER"] as const) {
      expect(getActionPolicy(action)).toMatchObject({
        approval: "REINFORCED_CONFIRMATION_REQUIRED",
        riskLevel: 3,
        confirmation: { required: true }
      });
      expect(lookupActionPolicy(action)).toMatchObject({ ok: true, data: { riskLevel: 3 } });
    }
    expect(getActionPolicy("DELETE_EVENT").availability).toBe("IMPLEMENTED");
    expect(getActionPolicy("DELETE_FILE").availability).toBe("DEFERRED");
  });
});
