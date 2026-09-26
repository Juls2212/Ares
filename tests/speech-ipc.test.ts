import { describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ handle: vi.fn(), speak: vi.fn(), clear: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: false }, ipcMain: { handle: mock.handle } }));
vi.mock("../src/main/voice/speech-composition", () => ({ speechService: { speak: mock.speak, clear: mock.clear } }));
import { registerSpeechIpcHandlers } from "../src/main/ipc/register-speech-ipc";

describe("speech IPC", () => {
  it("registers exactly once and binds the reference to the sender", async () => {
    registerSpeechIpcHandlers(); registerSpeechIpcHandlers();
    expect(mock.handle).toHaveBeenCalledTimes(1);
    expect(mock.handle.mock.calls[0][0]).toBe("speech:speak");
    const handler = mock.handle.mock.calls[0][1];
    const once = vi.fn(); const on = vi.fn(); const event = { sender: { id: 12, once, on } };
    mock.speak.mockResolvedValue({ ok: true, data: { audio: new ArrayBuffer(10), mimeType: "audio/mpeg" } });
    await handler(event, { responseId: "reference" });
    expect(mock.speak).toHaveBeenCalledWith(12, { responseId: "reference" });
    await handler(event, { responseId: "reference" });
    expect(once).toHaveBeenCalledOnce();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    on.mock.calls[0][1]({ message: "private raw content" });
    expect(log).not.toHaveBeenCalled();
    on.mock.calls[0][1]({ message: "Response playback event [PLAYING]." });
    expect(log).toHaveBeenCalledWith("Response playback event [PLAYING].");
    log.mockRestore();
    once.mock.calls[0][1](); expect(mock.clear).toHaveBeenCalledWith(12);
    mock.speak.mockRejectedValue(new Error("secret provider detail"));
    const failure = await handler(event, { responseId: "reference" });
    expect(failure).toMatchObject({ ok: false, error: { code: "SPEECH_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(failure)).not.toContain("secret");
  });
});
