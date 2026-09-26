import { app, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts";
import { speechService } from "../voice/speech-composition";

let registered = false;
const bound = new WeakSet<Electron.WebContents>();
// Forward only fixed development media milestones, never general renderer logs.
const playbackDiagnostics = new Set([
  ...["MP3_RECEIVED", "BLOB_READY", "LOADED_METADATA", "CAN_PLAY", "PLAYING", "ENDED", "STOPPED", "MEDIA_ABORTED", "MEDIA_NETWORK", "MEDIA_DECODE", "MEDIA_UNSUPPORTED", "MEDIA_UNKNOWN"].map((category) => `Response playback event [${category}].`),
  ...["MAIN_RESULT", "AUDIO_VALIDATION", "OBJECT_URL", "AUDIO_PLAYBACK", "PLAY_NOT_ALLOWED", "PLAY_NOT_SUPPORTED", "PLAY_ABORTED", "PLAY_START_TIMEOUT", "NO_PLAYING_EVENT"].map((category) => `Response playback failed [${category}].`)
]);
export const registerSpeechIpcHandlers = (): void => {
  if (registered) return;
  registered = true;
  ipcMain.handle(IPC_CHANNELS.speech.speak, async (event, input: unknown) => {
    const windowId = event.sender.id;
    if (!bound.has(event.sender)) {
      bound.add(event.sender);
      event.sender.once("destroyed", () => speechService.clear(windowId));
      if (!app.isPackaged) event.sender.on("console-message", (details) => {
        if (playbackDiagnostics.has(details.message)) console.info(details.message);
      });
    }
    try { return await speechService.speak(windowId, input); }
    catch { return { ok: false, error: { code: "SPEECH_IPC_UNAVAILABLE", userMessage: "No pude reproducir la voz. Puedes seguir leyendo la respuesta." } }; }
  });
};
