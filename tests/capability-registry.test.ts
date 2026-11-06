import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { getActionPolicy } from "../src/main/actions/action-policy";
import {
  CAPABILITY_DOMAINS,
  ENABLED_ASSISTANT_CAPABILITIES,
  getEnabledAssistantActionNames,
  getEnabledAssistantCapability
} from "../src/main/actions/capability-registry";

describe("assistant capability registry", () => {
  it("resolves enabled internal-memory, application, and web actions to fixed typed metadata", () => {
    const task = getEnabledAssistantCapability("CREATE_TASK");
    const deletion = getEnabledAssistantCapability("DELETE_EVENT");
    const application = getEnabledAssistantCapability("OPEN_APPLICATION");
    const search = getEnabledAssistantCapability("SEARCH_APPROVED_SITE");

    expect(task).toMatchObject({ domain: "INTERNAL_MEMORY", approval: "DIRECT", enabled: true, executor: "PLANNER" });
    expect(deletion).toMatchObject({ domain: "INTERNAL_MEMORY", approval: "REINFORCED_CONFIRMATION_REQUIRED", executor: "PLANNER" });
    expect(application).toMatchObject({ domain: "APPLICATIONS", approval: "DIRECT", enabled: true, executor: "APPLICATION" });
    expect(search).toMatchObject({ domain: "WEB", approval: "DIRECT", enabled: true, executor: "WEB" });
    expect(ENABLED_ASSISTANT_CAPABILITIES.every((capability) => capability.label.length > 0)).toBe(true);
  });

  it("enables the FILES and MESSAGING domains only for their explicit action lists", () => {
    expect(CAPABILITY_DOMAINS).toEqual(["INTERNAL_MEMORY", "APPLICATIONS", "WEB", "FILES", "MESSAGING", "MUSIC"]);
    expect(ENABLED_ASSISTANT_CAPABILITIES.filter((capability) => capability.domain === "MUSIC").map((capability) => [capability.action, capability.approval, capability.executor]).sort())
      .toEqual([
        ["CONNECT_SPOTIFY", "CONFIRMATION_REQUIRED", "MUSIC"],
        ["DISCONNECT_SPOTIFY", "CONFIRMATION_REQUIRED", "MUSIC"],
        ["GET_SPOTIFY_STATUS", "DIRECT", "MUSIC"],
        ["NEXT_SPOTIFY_TRACK", "DIRECT", "MUSIC"],
        ["PAUSE_SPOTIFY", "DIRECT", "MUSIC"],
        ["PLAY_SPOTIFY_MUSIC", "DIRECT", "MUSIC"],
        ["PREVIOUS_SPOTIFY_TRACK", "DIRECT", "MUSIC"],
        ["RESUME_SPOTIFY", "DIRECT", "MUSIC"],
        ["SET_SPOTIFY_VOLUME", "DIRECT", "MUSIC"],
        ["WHAT_IS_PLAYING", "DIRECT", "MUSIC"]
      ]);
    for (const action of ["SPOTIFY_REQUEST", "GET_SPOTIFY_TOKEN", "ADD_TO_PLAYLIST", "FOLLOW_ARTIST", "TRANSFER_PLAYBACK", "SEARCH_SPOTIFY"]) {
      expect(getEnabledAssistantCapability(action)).toBeUndefined();
    }
    expect(ENABLED_ASSISTANT_CAPABILITIES.filter((capability) => capability.domain === "MESSAGING").map((capability) => capability.action).sort())
      .toEqual([
        "DELETE_CONTACT", "DISCARD_MESSAGE_DRAFT", "EDIT_MESSAGE_DRAFT", "LIST_CONTACTS",
        "OPEN_WHATSAPP_CHAT_WITH_DRAFT", "PREPARE_MESSAGE_DRAFT", "SAVE_CONTACT"
      ]);
    expect(Object.fromEntries(
      ENABLED_ASSISTANT_CAPABILITIES.filter((capability) => capability.domain === "MESSAGING").map((capability) => [capability.action, [capability.approval, capability.executor]])
    )).toEqual({
      SAVE_CONTACT: ["CONFIRMATION_REQUIRED", "MESSAGING"],
      LIST_CONTACTS: ["DIRECT", "MESSAGING"],
      DELETE_CONTACT: ["REINFORCED_CONFIRMATION_REQUIRED", "MESSAGING"],
      PREPARE_MESSAGE_DRAFT: ["DIRECT", "MESSAGING"],
      EDIT_MESSAGE_DRAFT: ["DIRECT", "MESSAGING"],
      DISCARD_MESSAGE_DRAFT: ["DIRECT", "MESSAGING"],
      OPEN_WHATSAPP_CHAT_WITH_DRAFT: ["CONFIRMATION_REQUIRED", "MESSAGING"]
    });
    expect(getEnabledAssistantCapability("SEARCH_SPOTIFY_APP")).toMatchObject({ domain: "APPLICATIONS", approval: "DIRECT", executor: "APPLICATION" });
    for (const action of ["SEND_MESSAGE", "SEND_WHATSAPP", "OPEN_CHAT", "OPEN_URL", "READ_CONTACTS", "IMPORT_CONTACTS"]) {
      expect(getEnabledAssistantCapability(action)).toBeUndefined();
    }
    expect(ENABLED_ASSISTANT_CAPABILITIES.filter((capability) => capability.domain === "FILES").map((capability) => capability.action).sort())
      .toEqual([
        "CREATE_FOLDER", "DELETE_FOUND_ITEM", "MOVE_FOUND_ITEMS", "OPEN_FOUND_FILE",
        "ORGANIZE_FOUND_ITEMS", "RENAME_FOUND_ITEM", "REVEAL_FOUND_FILE", "SEARCH_FILES"
      ]);
    const filesClasses = Object.fromEntries(
      ENABLED_ASSISTANT_CAPABILITIES.filter((capability) => capability.domain === "FILES").map((capability) => [capability.action, capability.approval])
    );
    expect(filesClasses).toEqual({
      SEARCH_FILES: "DIRECT",
      REVEAL_FOUND_FILE: "DIRECT",
      OPEN_FOUND_FILE: "CONFIRMATION_REQUIRED",
      CREATE_FOLDER: "CONFIRMATION_REQUIRED",
      RENAME_FOUND_ITEM: "CONFIRMATION_REQUIRED",
      MOVE_FOUND_ITEMS: "CONFIRMATION_REQUIRED",
      ORGANIZE_FOUND_ITEMS: "CONFIRMATION_REQUIRED",
      DELETE_FOUND_ITEM: "REINFORCED_CONFIRMATION_REQUIRED"
    });
    expect(getEnabledAssistantCapability("OPEN_WEB_PAGE")).toBeUndefined();
    for (const action of ["RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "ORGANIZE_FILES", "DELETE_FILE", "DELETE_FOLDER"]) {
      expect(getEnabledAssistantCapability(action)).toBeUndefined();
    }
    expect(getEnabledAssistantCapability("RUN_SHELL")).toBeUndefined();
  });

  it("keeps registry confirmation classes aligned with the existing Main policy", () => {
    for (const capability of ENABLED_ASSISTANT_CAPABILITIES) {
      const policy = getActionPolicy(capability.action);
      expect(policy.approval).toBe(capability.approval);
      expect(policy.confirmation.required).toBe(capability.approval !== "DIRECT");
    }
  });

  it("keeps task and event actions registered while exposing no generic execution action", () => {
    const actions = getEnabledAssistantActionNames();

    expect(actions).toEqual(expect.arrayContaining(["CREATE_TASK", "UPDATE_EVENT", "DELETE_TASK", "DELETE_EVENT"]));
    expect(actions).toEqual(expect.arrayContaining(["OPEN_APPROVED_PAGE", "SEARCH_APPROVED_SITE"]));
    expect(actions).not.toContain("OPEN_WEB_PAGE");
    expect(actions).not.toContain("RENAME_FILE");
    expect(actions).not.toContain("MOVE_FILE");
    expect(actions).not.toContain("ORGANIZE_FILES");
    expect(actions).not.toContain("RUN_SHELL");
  });

  it("keeps the registry Main-only without adding a renderer or preload execution surface", () => {
    const preload = readFileSync(path.resolve(process.cwd(), "src/preload/preload.ts"), "utf8");
    const registry = readFileSync(path.resolve(process.cwd(), "src/main/actions/capability-registry.ts"), "utf8");
    const webExecutor = readFileSync(path.resolve(process.cwd(), "src/main/actions/approved-web-action-executor.ts"), "utf8");

    expect(preload).not.toContain("capabilityRegistry");
    expect(preload).not.toContain("genericInvoke");
    expect(preload).not.toContain("shell:");
    expect(preload).not.toContain("openExternal");
    expect(registry).not.toContain("ipcRenderer");
    expect(registry).not.toContain("executablePath");
    expect(registry).not.toContain("filesystem");
    expect(webExecutor).not.toContain("child_process");
    expect(webExecutor).not.toContain("exec(");
    expect(webExecutor).not.toContain("spawn(");
  });
});
