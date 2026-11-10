import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/shared/contracts";
import { readSource } from "./helpers/read-source";

const preloadSource = readSource("src/preload/preload.ts");
const rendererGlobalSource = readSource("src/renderer/global.d.ts");

describe("preload surface", () => {
  it("uses only the explicit system, action, assistant, voice, speech, messaging and settings channels", () => {
    expect(IPC_CHANNELS).toEqual({
      system: { getStatus: "system:get-status", getCapabilities: "system:get-capabilities" },
      actions: { propose: "actions:propose", confirm: "actions:confirm", cancel: "actions:cancel" },
      assistant: { interpret: "assistant:interpret" },
      voice: { transcribe: "voice:transcribe", globalShortcutActivated: "voice:global-shortcut-activated" },
      speech: { speak: "speech:speak" },
      messaging: {
        contactFormRequested: "messaging:contact-form-requested",
        submitContactForm: "messaging:contact-form:submit",
        cancelContactForm: "messaging:contact-form:cancel"
      },
      settings: { voice: { get: "settings:voice:get" } }
    });
  });

  it("exposes no planner, habit, dashboard or application method, and no history, context or preference-write method", () => {
    for (const removed of ["planner: {", "habits: {", "dashboard: {", "applications: {", "history: {", "context: {", "update:"]) {
      expect(preloadSource, removed).not.toContain(removed);
    }
    for (const group of ["planner", "habits", "dashboard", "applications"]) expect(IPC_CHANNELS, group).not.toHaveProperty(group);
    expect(IPC_CHANNELS.actions).not.toHaveProperty("history");
    expect(IPC_CHANNELS.assistant).not.toHaveProperty("context");
    expect(IPC_CHANNELS.settings.voice).not.toHaveProperty("update");
    expect(preloadSource).not.toMatch(/IPC_CHANNELS\.(?:planner|habits|dashboard|applications)\b/u);
  });

  it("exposes exactly the approved action methods", () => {
    expect(preloadSource).toContain("actions: {");
    expect(preloadSource).toContain("propose:");
    expect(preloadSource).toContain("confirm:");
    expect(preloadSource).toContain("cancel:");
    expect(preloadSource).not.toContain("execute:");
    expect(preloadSource).not.toContain("getResult:");
    expect(preloadSource).not.toContain("files:");
    expect(preloadSource).not.toContain("openWebPage:");
    expect(preloadSource).not.toContain("openUrl:");
    expect(preloadSource).not.toContain("browser:");
  });

  it("exposes interpretation only, with no executing, proposing or confirming assistant method", () => {
    expect(preloadSource).toContain("assistant: {");
    expect(preloadSource).toContain("interpret:");
    expect(preloadSource).not.toContain("assistant: {\n    execute:");
    expect(preloadSource).not.toContain("assistant: {\n    propose:");
    expect(preloadSource).not.toContain("assistant: {\n    confirm:");
    expect(preloadSource).not.toContain("OPENAI_API_KEY");
    expect(preloadSource).not.toContain("openai");
    expect(preloadSource).not.toContain("executablePath:");
    expect(preloadSource).not.toContain("showOpenDialog:");
  });

  it("exposes bounded transcription plus only the fixed shortcut subscription", () => {
    expect(preloadSource).toContain("voice: {");
    expect(preloadSource).toContain("transcribe:");
    expect(preloadSource).toContain("onGlobalShortcut:");
    expect(preloadSource).toContain("removeListener(IPC_CHANNELS.voice.globalShortcutActivated");
    expect(preloadSource).not.toContain("voice: {\n    start:");
    expect(preloadSource).not.toContain("getUserMedia:");
    expect(preloadSource).not.toContain("microphone:");
    // The shortcut subscription and the Main-initiated contact form request are the only two listeners.
    expect(preloadSource.match(/ipcRenderer\.on\(/g)).toHaveLength(2);
    expect(preloadSource).not.toContain("ipcRenderer.once(");
  });

  it("exposes three individually named messaging methods and no generic messaging, link or number access", () => {
    expect(preloadSource).toContain("messaging: {");
    expect(preloadSource).toContain("ipcRenderer.on(IPC_CHANNELS.messaging.contactFormRequested, listener)");
    expect(preloadSource).toContain("removeListener(IPC_CHANNELS.messaging.contactFormRequested, listener)");
    expect(preloadSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.messaging.submitContactForm, input)");
    expect(preloadSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.messaging.cancelContactForm, input)");
    const messagingBlock = preloadSource.slice(preloadSource.indexOf("messaging: {"), preloadSource.indexOf("speech: {"));
    expect(Object.keys(IPC_CHANNELS.messaging)).toHaveLength(3);
    expect(messagingBlock.match(/ipcRenderer\.invoke\(/g)).toHaveLength(2);
    for (const forbidden of ["listContacts", "getContact", "getPhone", "send", "openChat", "openExternal", "whatsapp", "wa.me"]) {
      expect(messagingBlock).not.toContain(forbidden);
    }
  });

  it("exposes only the voice-preference read method", () => {
    expect(preloadSource).toContain("settings: {");
    expect(preloadSource).toContain("voice: {");
    expect(preloadSource).toContain("get:");
    expect(preloadSource).not.toContain("update:");
    expect(preloadSource).not.toContain("settings: {\n    get:");
    expect(preloadSource).not.toContain("settings: {\n    write:");
    expect(preloadSource).not.toContain("settings: {\n    list:");
  });

  it("uses the same complete Ares API contract in the renderer declaration", () => {
    expect(rendererGlobalSource).toContain('import type { AresApi } from "../shared/contracts"');
    expect(rendererGlobalSource).toContain("ares: AresApi;");
    expect(rendererGlobalSource).not.toContain("ipcRenderer");
    expect(preloadSource).toContain("} satisfies AresApi;");
  });

  it("does not expose generic IPC or Node capabilities", () => {
    expect(preloadSource).toContain('contextBridge.exposeInMainWorld("ares", aresApi)');
    expect(preloadSource).not.toMatch(/\b(?:send|invoke)\s*:/);
    expect(preloadSource).not.toMatch(/\b(?:fs|path|shell|child_process|process\.env)\b/);
    expect(preloadSource).not.toContain('exposeInMainWorld("ares", ipcRenderer)');
  });
});
