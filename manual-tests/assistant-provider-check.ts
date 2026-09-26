import { getOpenAiConfiguration } from "../src/main/config/openai-environment";
import { createOpenAiStructuredProvider } from "../src/main/assistant/openai-structured-provider";
import { getAssistantProviderFailureCategory } from "../src/main/assistant/provider-failure-category";

/** Explicit single-request diagnostic. No output, input, prompt or configuration values are printed. */
export const run = async (): Promise<void> => {
  if (process.env.ARES_LIVE_ASSISTANT_CHECK !== "1") throw new Error("LIVE_ASSISTANT_NOT_AUTHORIZED");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12_000);
  try {
    const provider = createOpenAiStructuredProvider(getOpenAiConfiguration());
    const result = await provider.interpret({
      instruction: "Crea una tarea llamada Prueba de interpretación.",
      reference: { now: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      signal: abort.signal
    });
    console.log(typeof result === "string" && result.length > 0 ? "ASSISTANT_PROVIDER_CHECK_RESPONSE" : "ASSISTANT_PROVIDER_CHECK_EMPTY");
  } catch (error) {
    console.log(`ASSISTANT_PROVIDER_CHECK_${getAssistantProviderFailureCategory(error)}`);
  } finally { clearTimeout(timer); }
};
