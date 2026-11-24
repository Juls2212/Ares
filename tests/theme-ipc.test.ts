import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { createThemeIpcRegistration, type ThemeIpcHandler } from "../src/main/ipc/register-theme-ipc";
import { createThemePreferenceService, type ThemePreferenceStore } from "../src/main/settings/theme-preference-service";
import type { ThemePreference } from "../src/main/window-theme";
import { IPC_CHANNELS } from "../src/shared/contracts";
import { THEME_FAILURES, parseThemeSetPreferenceInput } from "../src/shared/theme-contracts";

const createFixture = (options: { save?: "ok" | "throws"; trusted?: boolean } = {}) => {
  const saved: ThemePreference[] = [];
  const store: ThemePreferenceStore = {
    get: async () => undefined,
    save: async (preference) => { if (options.save === "throws") throw new Error("database is down C:\\private"); saved.push(preference); }
  };
  const nativeTheme = { themeSource: "system" as ThemePreference };
  const onApplied = vi.fn();
  const logError = vi.fn();
  const service = createThemePreferenceService({ store: () => store, nativeTheme, onApplied, logError });
  const setSpy = vi.spyOn(service, "set");
  const handlers = new Map<string, ThemeIpcHandler>();
  const register = createThemeIpcRegistration({
    registerHandler: (channel, handler) => handlers.set(channel, handler),
    getService: () => service,
    isTrustedSender: () => options.trusted ?? true,
    logError
  });
  register();
  const call = (input: unknown, event: unknown = {}) => handlers.get(IPC_CHANNELS.theme.setPreference)!(input, event);
  return { call, handlers, register, setSpy, nativeTheme, onApplied, logError, saved, service };
};

describe("theme IPC channel", () => {
  it("registers exactly one channel, once, and it is the closed setter", () => {
    const { handlers, register } = createFixture();
    register();
    expect(IPC_CHANNELS.theme).toEqual({ setPreference: "theme:set-preference" });
    expect([...handlers.keys()]).toEqual(["theme:set-preference"]);
  });

  it.each(["light", "dark"] as const)("accepts { preference: %s }, applies it, persists it and returns { ok: true }", async (preference) => {
    const { call, nativeTheme, onApplied, saved, setSpy } = createFixture();
    expect(await call({ preference })).toEqual({ ok: true });
    expect(nativeTheme.themeSource).toBe(preference);
    expect(onApplied).toHaveBeenCalledOnce();
    expect(saved).toEqual([preference]);
    expect(setSpy).toHaveBeenCalledExactlyOnceWith(preference);
  });

  it("rejects every hostile payload with the closed invalid code and changes nothing", async () => {
    const { call, setSpy, nativeTheme, saved } = createFixture();
    const withProto = Object.create({ preference: "dark" });
    const symbolKey = { preference: "dark", [Symbol("x")]: 1 };
    const hostile: unknown[] = [
      undefined, null, "dark", 1, true, [], ["dark"], {}, { preference: "system" }, { preference: "auto" }, { preference: "DARK" }, { preference: "" },
      { preference: 1 }, { preference: null }, { preference: ["dark"] }, { preference: { toString: () => "dark" } },
      { preference: "dark", extra: 1 }, { preference: "dark", __proto__: { x: 1 }, y: 2 }, { Preference: "dark" }, { theme: "dark" },
      withProto, symbolKey, new Map([["preference", "dark"]]), Object.assign(() => undefined, { preference: "dark" })
    ];
    for (const input of hostile) {
      expect(await call(input), JSON.stringify(input)).toEqual(THEME_FAILURES.failure("THEME_PREFERENCE_INVALID"));
    }
    expect(setSpy).not.toHaveBeenCalled();
    expect(nativeTheme.themeSource).toBe("system");
    expect(saved).toEqual([]);
    expect(parseThemeSetPreferenceInput(Object.assign(Object.create(null), { preference: "light" }))).toBe("light");
  });

  it("rejects a sender that is not the trusted window's top frame, before reading the payload", async () => {
    const { call, setSpy, nativeTheme } = createFixture({ trusted: false });
    expect(await call({ preference: "dark" })).toEqual(THEME_FAILURES.failure("THEME_UNAVAILABLE"));
    expect(setSpy).not.toHaveBeenCalled();
    expect(nativeTheme.themeSource).toBe("system");
  });

  it("still applies the theme for the session when saving fails, and returns the closed not-saved failure with one fixed log line", async () => {
    const { call, nativeTheme, onApplied, logError } = createFixture({ save: "throws" });
    const result = await call({ preference: "dark" });
    expect(result).toEqual(THEME_FAILURES.failure("THEME_NOT_SAVED"));
    expect(nativeTheme.themeSource).toBe("dark");
    expect(onApplied).toHaveBeenCalledOnce();
    expect(logError.mock.calls).toEqual([["Theme preference could not be saved."]]);
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(/database|private|Users/u);
  });

  it("maps an unexpected failure to the closed unavailable code without leaking its cause", async () => {
    const logError = vi.fn();
    const handlers = new Map<string, ThemeIpcHandler>();
    createThemeIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => { throw new Error("secret detail"); },
      isTrustedSender: () => true,
      logError
    })();
    const result = await handlers.get("theme:set-preference")!({ preference: "dark" }, {});
    expect(result).toEqual(THEME_FAILURES.failure("THEME_UNAVAILABLE"));
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(logError.mock.calls).toEqual([["Theme preference IPC handler failed."]]);
  });

  it("has bounded Spanish messages and a closed code list", () => {
    expect(THEME_FAILURES.codes).toEqual(["THEME_PREFERENCE_INVALID", "THEME_NOT_SAVED", "THEME_UNAVAILABLE"]);
    for (const message of Object.values(THEME_FAILURES.messages)) expect(message.length).toBeLessThan(80);
  });

  it("uses the same Main service as the tray menu (one code path), checks the sender frame, and exposes no getter", () => {
    const main = readFileSync("src/main/main.ts", "utf8");
    expect(main).toContain("registerThemeIpcHandlers(() => themePreferenceService,");
    expect(main).toContain("theme: { current: () => themePreferenceService.get(), choose: (preference) => { void themePreferenceService.set(preference); } }");
    expect(main).toContain("trustedRendererWebContents.has(sender.sender.id) && sender.senderFrame === sender.sender.mainFrame");
    expect(main).toContain("onApplied: () => { applyWindowTheme(); backgroundLifecycle.refreshTray(); }");
    const preload = readFileSync("src/preload/preload.ts", "utf8");
    expect(preload.match(/IPC_CHANNELS\.theme\./gu)).toHaveLength(1);
    expect(preload).not.toMatch(/theme:\s*\{[^}]*(?:get|list|read)/u);
    const contracts = readFileSync("src/shared/theme-contracts.ts", "utf8");
    const start = contracts.indexOf("export type ThemeApi");
    const apiBlock = contracts.slice(start, contracts.indexOf("};", start));
    expect(apiBlock.match(/^\s+\w+:/gmu)?.map((line) => line.trim())).toEqual(["setPreference:"]);
  });
});
