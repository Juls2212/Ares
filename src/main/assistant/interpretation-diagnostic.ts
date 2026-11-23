import type { AssistantInterpretation, AssistantOperationResult } from "../../shared/assistant-contracts";
import { getEnabledAssistantCapability } from "../actions/capability-registry";

export const INTERPRETATION_KINDS = ["action", "clarification", "small_talk", "unsupported", "failure"] as const;
export const INTERPRETATION_OUTCOMES = ["success", "failure", "cancelled", "clarification", "none"] as const;

type Kind = (typeof INTERPRETATION_KINDS)[number];
type Outcome = (typeof INTERPRETATION_OUTCOMES)[number];

const KIND_BY_STATE: Readonly<Record<AssistantInterpretation["state"], Kind>> = {
  READY: "action",
  CONVERSATIONAL: "small_talk",
  NEEDS_CLARIFICATION: "clarification",
  REJECTED: "unsupported",
  UNAVAILABLE: "failure"
};

const OUTCOME_BY_KIND: Readonly<Record<Kind, Outcome>> = {
  action: "success",
  small_talk: "success",
  clarification: "clarification",
  unsupported: "none",
  failure: "failure"
};

/**
 * One closed-enum line per interpreted turn. Only the interpretation state, the first enabled action name and its
 * registry domain are read; summaries, questions, drafts' inputs, instructions and paths are never touched.
 */
export const formatInterpretationDiagnostic = (result: AssistantOperationResult<AssistantInterpretation>): string => {
  const kind: Kind = result.ok ? (Object.prototype.hasOwnProperty.call(KIND_BY_STATE, result.data.state) ? KIND_BY_STATE[result.data.state] : "failure") : "failure";
  const firstAction = result.ok ? result.data.drafts[0]?.action : undefined;
  const capability = kind === "action" ? getEnabledAssistantCapability(firstAction) : undefined;
  return `interpret kind=${kind} capability=${capability?.action ?? "none"} outcome=${OUTCOME_BY_KIND[kind]} domain=${capability?.domain ?? "none"}`;
};
