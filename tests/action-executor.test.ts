import { describe, expect, it, vi } from "vitest";
import { createActionExecutor } from "../src/main/actions/action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { ApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import type { FileActionExecutor } from "../src/main/actions/file-action-executor";
import type { PlannerActionExecutor } from "../src/main/actions/planner-action-executor";

const actionId = "11111111-1111-4111-8111-111111111111";

describe("action executor routing", () => {
  it("routes approved file actions only to the Main-only file executor and preserves planner routing", async () => {
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
    const fileExecutor: FileActionExecutor = {
      execute: vi.fn(async (proposal, policy) => ({
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: policy.riskLevel,
        status: "SUCCEEDED" as const,
        userSummary: "Se completó la acción de archivos autorizada."
      }))
    };
    const executor = createActionExecutor({ plannerExecutor, applicationExecutor, fileExecutor });

    await executor.execute(
      {
        actionId,
        action: "SEARCH_FILES",
        input: { rootId: "DOCUMENTS", query: "report" }
      },
      getActionPolicy("SEARCH_FILES")
    );
    await executor.execute(
      { actionId, action: "CREATE_TASK", input: { title: "Review report" } },
      getActionPolicy("CREATE_TASK")
    );

    expect(fileExecutor.execute).toHaveBeenCalledTimes(1);
    expect(plannerExecutor.execute).toHaveBeenCalledTimes(1);
    expect(applicationExecutor.execute).not.toHaveBeenCalled();
  });
});
