import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "../src/shared/contracts";
import { readSource } from "./helpers/read-source";

const exposed = vi.hoisted(() => ({ api: undefined as unknown, keys: [] as string[], on: [] as string[], invoke: [] as string[] }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => { exposed.keys.push(key); exposed.api = api; } },
  ipcRenderer: {
    invoke: (channel: string) => { exposed.invoke.push(channel); return Promise.resolve({ ok: true, data: {} }); },
    on: (channel: string) => { exposed.on.push(channel); },
    removeListener: vi.fn()
  }
}));

/**
 * Names inventory of the renderer-facing surface (14 methods, 14 channels: UI 7.2 added theme.setPreference). The existing preload-surface
 * test checks behavior and shape; this file lists every exposed method and every IPC channel so each change is deliberate.
 */
const EXPECTED_METHODS = [
  "system.getStatus",
  "system.getCapabilities",
  "actions.propose",
  "actions.confirm",
  "actions.cancel",
  "assistant.interpret",
  "voice.transcribe",
  "voice.onGlobalShortcut",
  "messaging.onContactFormRequested",
  "messaging.submitContactForm",
  "messaging.cancelContactForm",
  "speech.speak",
  "settings.voice.get",
  "theme.setPreference"
];

const EXPECTED_CHANNELS = [
  "system.getStatus=system:get-status",
  "system.getCapabilities=system:get-capabilities",
  "actions.propose=actions:propose",
  "actions.confirm=actions:confirm",
  "actions.cancel=actions:cancel",
  "assistant.interpret=assistant:interpret",
  "voice.transcribe=voice:transcribe",
  "voice.globalShortcutActivated=voice:global-shortcut-activated",
  "speech.speak=speech:speak",
  "messaging.contactFormRequested=messaging:contact-form-requested",
  "messaging.submitContactForm=messaging:contact-form:submit",
  "messaging.cancelContactForm=messaging:contact-form:cancel",
  "settings.voice.get=settings:voice:get",
  "theme.setPreference=theme:set-preference"
];

const methodNames = (value: unknown, prefix = ""): string[] =>
  typeof value === "function"
    ? [prefix]
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => methodNames(child, prefix ? `${prefix}.${key}` : key))
      : [];

const channelNames = (value: unknown, prefix = ""): string[] =>
  typeof value === "string"
    ? [`${prefix}=${value}`]
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => channelNames(child, prefix ? `${prefix}.${key}` : key))
      : [];

describe("preload surface names", () => {
  it("exposes exactly one global named ares", async () => {
    await import("../src/preload/preload");
    expect(exposed.keys).toEqual(["ares"]);
  });

  it("exposes exactly the listed methods", async () => {
    await import("../src/preload/preload");
    expect(methodNames(exposed.api)).toEqual(EXPECTED_METHODS);
  });

  it("defines exactly the listed IPC channels", () => {
    expect(channelNames(IPC_CHANNELS)).toEqual(EXPECTED_CHANNELS);
  });

  it("exposes no generic invoke, send, on or ipcRenderer handle to the renderer", async () => {
    await import("../src/preload/preload");
    const api = exposed.api as Record<string, unknown>;
    for (const forbidden of ["invoke", "send", "on", "emit", "ipcRenderer", "require", "process", "shell", "fs"]) {
      expect(api, forbidden).not.toHaveProperty(forbidden);
    }
    const source = readSource("src/preload/preload.ts");
    expect(source).toContain('contextBridge.exposeInMainWorld("ares", aresApi)');
    expect(source).not.toMatch(/exposeInMainWorld\("(?!ares")/u);
    expect(source).not.toMatch(/ipcRenderer\.(?:invoke|send|on)\((?!IPC_CHANNELS\.|\s*IPC_CHANNELS)/u);
  });

  it("only ever uses channels from the IPC_CHANNELS table when a method is called", async () => {
    await import("../src/preload/preload");
    const known = new Set(channelNames(IPC_CHANNELS).map((entry) => entry.split("=")[1]));
    const api = exposed.api as Record<string, Record<string, unknown>>;
    const call = (value: unknown): void => {
      if (typeof value === "function") { try { (value as (input?: unknown) => unknown)({}); } catch { /* callbacks need arguments */ } }
      else if (value && typeof value === "object") Object.values(value).forEach(call);
    };
    call(api);
    for (const channel of [...exposed.invoke, ...exposed.on]) expect(known.has(channel), channel).toBe(true);
  });
});
