import type { ActionSubmission } from "../../../shared/action-contracts";
import type { AssistantInterpretation } from "../../../shared/assistant-contracts";

/** One completed recording is one explicit instruction; Main owns every risk decision. */
export const createVoiceTranscriptSubmission = () => {
  let lastGeneration = -1;
  let busy = false;
  return {
    async submit(input: {
      generation: number;
      text: string;
      isCurrent: () => boolean;
      showTranscript: (text: string) => void;
      interpret: (text: string) => Promise<AssistantInterpretation | undefined>;
      propose: (index: number, draft: ActionSubmission) => Promise<void>;
    }): Promise<void> {
      if (busy || input.generation <= lastGeneration || !input.isCurrent() || !input.text.trim()) return;
      busy = true;
      lastGeneration = input.generation;
      try {
        input.showTranscript(input.text);
        const result = await input.interpret(input.text);
        if (!input.isCurrent() || result?.state !== "READY") return;
        for (const [index, draft] of result.drafts.entries()) {
          if (!input.isCurrent()) return;
          await input.propose(index, draft);
        }
      } finally { busy = false; }
    }
  };
};
