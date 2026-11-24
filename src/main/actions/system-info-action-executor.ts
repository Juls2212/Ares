import { failedOutcome, outcomeIdentity, succeededOutcome } from "../../shared/outcome-kit";
import type { ActionOutcome, ActionPolicy, SystemInfoActionProposal } from "../../shared/action-contracts";
import {
  SYSTEM_INFO_ERROR_CODES,
  createSystemInfoService,
  systemInfoUserMessage,
  type SystemInfoService
} from "../system/system-info";

export type SystemInfoActionExecutor = {
  execute: (proposal: SystemInfoActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type SystemInfoActionExecutorDependencies = {
  systemInfoService?: SystemInfoService;
  logError: (message: string) => void;
};

/**
 * Read-only computer information. The outcome carries only the spoken Spanish sentence: no data payload, so the numbers exist
 * only in the sentence that is spoken and shown to the person (history stores a fixed generic sentence instead).
 */
export const createSystemInfoActionExecutor = (
  overrides: Partial<SystemInfoActionExecutorDependencies> = {}
): SystemInfoActionExecutor => {
  let service = overrides.systemInfoService;
  const logError = overrides.logError ?? ((message: string) => { console.error(message); });
  return {
    execute: async (proposal, policy) => {
      const identity = outcomeIdentity(proposal, policy);
      try {
        service ??= createSystemInfoService();
        const result = await service.getSystemInfo(proposal.input);
        if (!result.ok) {
          return failedOutcome(
            identity,
            result.error.code === SYSTEM_INFO_ERROR_CODES.inputInvalid ? "VALIDATION_FAILED" : "EXECUTION_FAILED",
            result.error.code,
            result.error.userMessage
          );
        }
        return succeededOutcome(identity, result.data.summary);
      } catch {
        logError("System information action execution failed.");
        return failedOutcome(identity, "EXECUTION_FAILED", SYSTEM_INFO_ERROR_CODES.unavailable, systemInfoUserMessage(SYSTEM_INFO_ERROR_CODES.unavailable));
      }
    }
  };
};
