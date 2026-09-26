import { getOpenAiSpeechConfiguration } from "../config/openai-environment";
import { createOpenAiSpeechProvider } from "./openai-speech-provider";
import { createSpeechService } from "./speech-service";

export const speechService = createSpeechService(() => createOpenAiSpeechProvider(getOpenAiSpeechConfiguration().apiKey));
