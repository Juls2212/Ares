import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "../src/shared/contracts";
import { listSourceFiles, readSource } from "./helpers/read-source";

const exposed = vi.hoisted(() => ({ api: undefined as unknown, invoked: [] as string[], listened: [] as string[] }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_key: string, api: unknown) => { exposed.api = api; } },
  ipcRenderer: {
    invoke: (channel: string) => { exposed.invoked.push(channel); return Promise.resolve({ ok: true, data: {} }); },
    on: (channel: string) => { exposed.listened.push(channel); },
    removeListener: vi.fn()
  }
}));

/**
 * Every IPC channel must have exactly one Main registration and exactly one preload method, so a dead channel cannot
 * reappear silently. The two push channels (Main to renderer) are the documented exception: they are sent by Main
 * and listened to by one preload subscription instead of being registered with ipcMain.
 */
const PUSH_CHANNELS: Record<string, string> = {
  "messaging.contactFormRequested": "Main shows the contact form: sent once from main.ts, subscribed once in the preload",
  "voice.globalShortcutActivated": "the global shortcut: sent once from global-voice-shortcut.ts, subscribed once in the preload"
};

const flatten = (value: unknown, prefix = ""): Array<[string, string]> =>
  typeof value === "string"
    ? [[prefix, value]]
    : Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));

const channels = flatten(IPC_CHANNELS);
const mainFiles = listSourceFiles("src/main").map((file) => [file, readSource(file)] as const);
const preload = readSource("src/preload/preload.ts");

const countMatches = (pattern: RegExp): number => mainFiles.reduce((total, [, text]) => total + (text.match(pattern)?.length ?? 0), 0);
const escape = (name: string): string => name.replace(/\./gu, "\\.");

describe("IPC channel registry", () => {
  it("has unique channel names in the allowed namespaces", () => {
    const names = channels.map(([, name]) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^(?:system|actions|assistant|voice|speech|messaging|settings|theme):[a-z:-]+$/u);
  });

  it("registers every invoke channel exactly once in Main, inside src/main/ipc", () => {
    for (const [path] of channels.filter(([key]) => !(key in PUSH_CHANNELS))) {
      const registration = new RegExp(`(?:registerHandler|ipcMain\\.handle)\\(\\s*IPC_CHANNELS\\.${escape(path)}\\b`, "gu");
      expect(countMatches(registration), `${path} registrations`).toBe(1);
      const inIpcFolder = mainFiles.filter(([file, text]) => file.startsWith("src/main/ipc/") && registration.test(text));
      expect(inIpcFolder.length, `${path} must be registered in src/main/ipc`).toBe(1);
    }
  });

  it("sends each push channel from Main exactly once and registers no handler for it", () => {
    for (const path of Object.keys(PUSH_CHANNELS)) {
      expect(countMatches(new RegExp(`webContents\\.send\\(IPC_CHANNELS\\.${escape(path)}\\b`, "gu")), `${path} sends`).toBe(1);
      expect(countMatches(new RegExp(`(?:registerHandler|ipcMain\\.handle)\\(\\s*IPC_CHANNELS\\.${escape(path)}\\b`, "gu")), `${path} handlers`).toBe(0);
    }
    for (const reason of Object.values(PUSH_CHANNELS)) expect(reason.length).toBeGreaterThan(20);
  });

  it("uses every channel in exactly one preload method (one invoke, or one subscription for a push channel)", () => {
    for (const [path] of channels) {
      const use = new RegExp(`ipcRenderer\\.(?:invoke|on)\\(IPC_CHANNELS\\.${escape(path)}\\b`, "gu");
      expect(preload.match(use)?.length ?? 0, `${path} preload uses`).toBe(1);
    }
  });

  it("gives every preload method a channel from the table and every channel a preload method", async () => {
    await import("../src/preload/preload");
    const call = (value: unknown): void => {
      if (typeof value === "function") { try { void (value as (input?: unknown) => unknown)({}); } catch { /* subscriptions need a callback */ } }
      else if (value && typeof value === "object") Object.values(value).forEach(call);
    };
    call(exposed.api);
    const used = new Set([...exposed.invoked, ...exposed.listened]);
    expect([...used].sort()).toEqual(channels.map(([, name]) => name).sort());
  });

  it("has no leftover reference to a removed channel anywhere in src", () => {
    const everything = [...mainFiles.map(([, text]) => text), preload, ...listSourceFiles("src/renderer").map(readSource), ...listSourceFiles("src/shared").map(readSource)].join("\n");
    expect(everything).not.toMatch(/IPC_CHANNELS\.(?:planner|habits|dashboard|applications)\b|actions\.history|assistant\.context|settings\.voice\.update/u);
  });
});
