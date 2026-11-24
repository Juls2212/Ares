import { ElevenLabsSpeechError, ELEVENLABS_FAILURES, type ElevenLabsConfiguration } from "./elevenlabs-speech-provider";
import type { SpeechProvider } from "./speech-service";

export type SpeechProviderSelectionDependencies = {
  elevenLabsConfiguration: () => ElevenLabsConfiguration | undefined;
  createElevenLabs: (configuration: ElevenLabsConfiguration | undefined) => SpeechProvider;
  createOpenAi: () => SpeechProvider;
  log?: (line: string) => void;
};

/**
 * ElevenLabs when both settings exist, OpenAI otherwise. If ElevenLabs fails for any reason the same utterance is
 * synthesized by OpenAI, so the person still hears the answer. Log lines carry a provider name or a closed code only.
 */
export const createFallbackSpeechProvider = (dependencies: SpeechProviderSelectionDependencies): SpeechProvider => {
  const log = dependencies.log ?? ((line: string) => console.info(line));
  return async (text, signal) => {
    let configuration: ElevenLabsConfiguration | undefined;
    try { configuration = dependencies.elevenLabsConfiguration(); } catch { configuration = undefined; }
    if (!configuration) return dependencies.createOpenAi()(text, signal);
    try {
      const audio = await dependencies.createElevenLabs(configuration)(text, signal);
      log("Speech provider used [ELEVENLABS].");
      return audio;
    } catch (error) {
      if (signal.aborted) throw error;
      const code = error instanceof ElevenLabsSpeechError && ELEVENLABS_FAILURES.isCode(error.code) ? error.code : "ELEVENLABS_UNAVAILABLE";
      log(`Speech provider fallback to OpenAI [${code}].`);
      return dependencies.createOpenAi()(text, signal);
    }
  };
};
