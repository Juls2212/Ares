import { getElevenLabsSpeechConfiguration, getOpenAiSpeechConfiguration } from "../config/openai-environment";
import { createElevenLabsSpeechProvider } from "./elevenlabs-speech-provider";
import { createOpenAiSpeechProvider } from "./openai-speech-provider";
import { createFallbackSpeechProvider } from "./speech-provider-selection";
import { createSpeechService } from "./speech-service";

export const speechService = createSpeechService(() => createFallbackSpeechProvider({
  elevenLabsConfiguration: getElevenLabsSpeechConfiguration,
  createElevenLabs: createElevenLabsSpeechProvider,
  createOpenAi: () => createOpenAiSpeechProvider(getOpenAiSpeechConfiguration().apiKey)
}));
