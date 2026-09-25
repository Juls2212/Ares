import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { createVoiceIpcRegistration, type VoiceIpcHandler } from "../src/main/ipc/register-voice-ipc";
import { IPC_CHANNELS } from "../src/shared/contracts";

const audio = new Uint8Array([1]).buffer;

describe("voice IPC registration", () => {
  it("registers only transcribe once and redacts unexpected failures", async () => {
    const handlers = new Map<string, VoiceIpcHandler>();
    const transcribe = vi.fn(async () => ({ ok: true as const, data: { text: "Texto seguro" } }));
    const register = createVoiceIpcRegistration({ registerHandler: (channel, handler) => handlers.set(channel, handler), getService: () => ({ transcribe }), logError: vi.fn() });
    register(); register();
    expect([...handlers.keys()]).toEqual([IPC_CHANNELS.voice.transcribe]);
    await handlers.get(IPC_CHANNELS.voice.transcribe)?.({ audio, mimeType: "audio/webm" });
    expect(transcribe).toHaveBeenCalledOnce();
  });
});
