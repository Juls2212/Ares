import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/shared/contracts";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("action policy boundaries", () => {
  it("keeps shared action contracts platform-neutral and the policy Main-only", () => {
    const contracts = source("src/shared/action-contracts.ts");
    const policy = source("src/main/actions/action-policy.ts");
    expect(contracts).not.toMatch(/from ["'](?:electron|node:|drizzle-orm|pg)[^"']*["']/u);
    expect(contracts).not.toMatch(/from ["'][^"']*(?:main|renderer|preload|database)[^"']*["']/u);
    expect(policy).not.toMatch(/from ["'](?:electron|node:|drizzle-orm|pg)[^"']*["']/u);
    expect(policy).not.toMatch(/from ["'][^"']*(?:renderer|preload|database|filesystem)[^"']*["']/u);
  });

  it("adds no generic renderer execution or IPC channel", () => {
    const preload = source("src/preload/preload.ts");
    expect(IPC_CHANNELS.actions).toEqual({
      propose: "actions:propose",
      confirm: "actions:confirm",
      cancel: "actions:cancel"
    });
    expect(preload).not.toContain("actions: {\n    execute:");
    expect(preload).not.toContain("ipcRenderer: ipcRenderer");
    expect(preload).not.toContain("genericInvoke");
    // Registration files never create an action-execution channel: only the action IPC registers IPC_CHANNELS.actions.
    for (const registration of ["register-assistant-ipc", "register-messaging-ipc", "register-speech-ipc", "register-voice-ipc", "register-settings-ipc", "register-system-ipc"]) {
      expect(source(`src/main/ipc/${registration}.ts`), registration).not.toContain("IPC_CHANNELS.actions");
    }
  });
});
