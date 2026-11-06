import { describe, expect, it, vi } from "vitest";

import { createActionExecutor } from "../src/main/actions/action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { ApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import type { ApprovedWebActionExecutor } from "../src/main/actions/approved-web-action-executor";
import type { PlannerActionExecutor } from "../src/main/actions/planner-action-executor";

const actionId = "11111111-1111-4111-8111-111111111111";

describe("action executor routing", () => {
  it("routes enabled internal-memory, application, and approved web capabilities to fixed Main executors", async () => {
    const plannerExecutor: PlannerActionExecutor = {
      execute: vi.fn(async (proposal, policy) => ({
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: policy.riskLevel,
        status: "SUCCEEDED" as const,
        userSummary: "Se completó la acción del planificador."
      }))
    };
    const applicationExecutor: ApplicationActionExecutor = {
      execute: vi.fn(async (proposal, policy) => ({
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: policy.riskLevel,
        status: "SUCCEEDED" as const,
        userSummary: "Se abrió la aplicación registrada."
      }))
    };
    const approvedWebExecutor: ApprovedWebActionExecutor = {
      execute: vi.fn(async (proposal, policy) => ({
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: policy.riskLevel,
        status: "SUCCEEDED" as const,
        data: { site: "GOOGLE" as const, mode: "HOME" as const },
        userSummary: "Listo, abrí Google."
      }))
    };
    const executor = createActionExecutor({ plannerExecutor, applicationExecutor, approvedWebExecutor });

    await executor.execute(
      { actionId, action: "OPEN_APPLICATION", input: { alias: "chrome" } },
      getActionPolicy("OPEN_APPLICATION")
    );
    await executor.execute(
      { actionId, action: "CREATE_TASK", input: { title: "Review report" } },
      getActionPolicy("CREATE_TASK")
    );
    await executor.execute(
      { actionId, action: "OPEN_APPROVED_PAGE", input: { site: "GOOGLE" } },
      getActionPolicy("OPEN_APPROVED_PAGE")
    );

    expect(plannerExecutor.execute).toHaveBeenCalledOnce();
    expect(applicationExecutor.execute).toHaveBeenCalledOnce();
    expect(approvedWebExecutor.execute).toHaveBeenCalledOnce();
  });

  it("does not dispatch legacy web, file, weather, or habit actions", async () => {
    const plannerExecutor: PlannerActionExecutor = { execute: vi.fn() };
    const applicationExecutor: ApplicationActionExecutor = { execute: vi.fn() };
    const executor = createActionExecutor({ plannerExecutor, applicationExecutor });

    const result = await executor.execute(
      { actionId, action: "OPEN_WEB_PAGE", input: { destination: "YOUTUBE", browser: "CHROME" } },
      getActionPolicy("OPEN_WEB_PAGE")
    );

    expect(result).toMatchObject({ status: "VALIDATION_FAILED", errorCode: "ACTION_UNSUPPORTED" });
    expect(plannerExecutor.execute).not.toHaveBeenCalled();
    expect(applicationExecutor.execute).not.toHaveBeenCalled();
  });
});
