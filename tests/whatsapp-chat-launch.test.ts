import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
  dialog: {},
  shell: { openExternal: vi.fn(async (_url: string) => undefined) }
}));

import { shell } from "electron";
import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createMessagingActionExecutor } from "../src/main/actions/messaging-action-executor";
import { attachSpokenActionResponse } from "../src/main/ipc/register-action-ipc";
import { MESSAGING_FAILURES } from "../src/main/messaging/messaging-failures";
import {
  composeChatUrls,
  createWhatsAppChatLauncher,
  isAllowedChatUrl,
  MAX_CHAT_URL_LENGTH
} from "../src/main/messaging/whatsapp-chat-launcher";
import { createFakeMessagingFlow, type FakeMessagingFlow } from "./helpers/fake-messaging";

const DIGITS = "573001234567";
const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("chat link composition", () => {
  it("builds exactly the two fixed templates from digits and the encoded text", () => {
    expect(composeChatUrls(DIGITS, "hola")).toEqual({
      ok: true,
      links: {
        primary: `whatsapp://send?phone=${DIGITS}&text=hola`,
        fallback: `https://wa.me/${DIGITS}?text=hola`
      }
    });
  });

  it("percent-encodes accents, emoji, line breaks, spaces and reserved characters", () => {
    const body = "Hola, ¿cómo estás? 😀\nTotal: a&b #1 ?x=1 100%";
    const composed = composeChatUrls(DIGITS, body);
    if (!composed.ok) throw new Error("Expected links.");
    const encoded = encodeURIComponent(body);
    expect(composed.links.primary).toBe(`whatsapp://send?phone=${DIGITS}&text=${encoded}`);
    expect(composed.links.fallback).toBe(`https://wa.me/${DIGITS}?text=${encoded}`);
    for (const link of [composed.links.primary, composed.links.fallback]) {
      const text = link.slice(link.indexOf("text=") + 5);
      expect(text).not.toMatch(/[&# ?\n=]/u);
      expect(text).toContain("%C3%B3");
      expect(text).toContain("%F0%9F%98%80");
      expect(text).toContain("%0A");
      expect(text).toContain("%26");
      expect(text).toContain("%23");
      expect(text).toContain("%25");
      expect(new URL(link).searchParams.get("text")).toBe(body);
      expect(isAllowedChatUrl(link)).toBe(true);
    }
  });

  it.each(["", "abc", "0573001234567", "+573001234567", "5730012", "1234567890123456", "57 300 123", "573001234567&text=x", "573001234567/../1"])(
    "refuses the phone value %j",
    (digits) => {
      expect(composeChatUrls(digits, "hola")).toEqual({ ok: false, reason: "INVALID_TARGET" });
    }
  );

  it("refuses an empty text", () => {
    expect(composeChatUrls(DIGITS, "")).toEqual({ ok: false, reason: "INVALID_TARGET" });
  });

  it("caps the link length and rejects a text that encodes beyond it", () => {
    expect(MAX_CHAT_URL_LENGTH).toBe(2000);
    // whatsapp://send?phone=<12 digits>&text= is 40 characters long.
    expect(composeChatUrls(DIGITS, "a".repeat(1960))).toMatchObject({ ok: true });
    expect(composeChatUrls(DIGITS, "a".repeat(1961))).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(composeChatUrls(DIGITS, "😀".repeat(200))).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(composeChatUrls(DIGITS, "á".repeat(300))).toMatchObject({ ok: true });
  });
});

describe("allowlist", () => {
  const ok = [`whatsapp://send?phone=${DIGITS}&text=hola`, `https://wa.me/${DIGITS}?text=hola%20mundo`, `https://wa.me/${DIGITS}?text=`];
  it.each(ok)("accepts %s", (url) => {
    expect(isAllowedChatUrl(url)).toBe(true);
  });

  it.each([
    `https://wa.me/${DIGITS}?text=a&x=1`,
    `http://wa.me/${DIGITS}?text=a`,
    `https://wa.me.evil.example/${DIGITS}?text=a`,
    `https://evil.example/wa.me/${DIGITS}?text=a`,
    `https://user@wa.me/${DIGITS}?text=a`,
    `https://wa.me:444/${DIGITS}?text=a`,
    `https://wa.me/${DIGITS}/extra?text=a`,
    `https://wa.me/${DIGITS}?text=a#fragment`,
    `https://wa.me/${DIGITS}`,
    `https://api.whatsapp.com/send?phone=${DIGITS}&text=a`,
    `whatsapp://send?phone=${DIGITS}&text=a&extra=1`,
    `whatsapp://send?text=a&phone=${DIGITS}`,
    `whatsapp://send?phone=${DIGITS}`,
    `whatsapp://send/?phone=${DIGITS}&text=a`,
    `whatsapp://other?phone=${DIGITS}&text=a`,
    `whatsapp://send?phone=+${DIGITS}&text=a`,
    `whatsapp://send?phone=0573001234567&text=a`,
    `whatsapp://send?phone=${DIGITS}&text=a b`,
    `whatsapp://send?phone=${DIGITS}&text=a%ZZ`,
    `whatsapp://send?phone=${DIGITS}&text=%61`,
    `whatsapp://send?phone=${DIGITS}&text=a\nb`,
    `https://wa.me/${DIGITS}?text=${"a".repeat(MAX_CHAT_URL_LENGTH)}`,
    "javascript:alert(1)",
    "file:///C:/Windows/System32/calc.exe",
    "spotify:search:x",
    "calc.exe",
    ""
  ])("rejects %j", (url) => {
    expect(isAllowedChatUrl(url)).toBe(false);
  });
});

describe("launcher", () => {
  const create = (behavior: (url: string) => Promise<void>) => {
    const openExternal = vi.fn(behavior);
    const logError = vi.fn();
    return { openExternal, logError, launcher: createWhatsAppChatLauncher({ openExternal, logError }) };
  };

  it("opens the primary scheme once and never the fallback when it succeeds", async () => {
    const { launcher, openExternal } = create(async () => undefined);
    await expect(launcher.open({ digits: DIGITS, body: "hola 😀" })).resolves.toEqual({ ok: true });
    expect(openExternal.mock.calls).toEqual([[`whatsapp://send?phone=${DIGITS}&text=${encodeURIComponent("hola 😀")}`]]);
  });

  it("falls back to wa.me when the primary throws", async () => {
    const { launcher, openExternal } = create(async (url) => {
      if (url.startsWith("whatsapp:")) throw new Error("no handler");
    });
    await expect(launcher.open({ digits: DIGITS, body: "hola" })).resolves.toEqual({ ok: true });
    expect(openExternal.mock.calls).toEqual([[`whatsapp://send?phone=${DIGITS}&text=hola`], [`https://wa.me/${DIGITS}?text=hola`]]);
  });

  it("reports an open failure, without claiming success, when both attempts throw", async () => {
    const { launcher, openExternal, logError } = create(async (url) => {
      throw new Error(`cannot open ${url}`);
    });
    const result = await launcher.open({ digits: DIGITS, body: "secreto" });
    expect(result).toEqual({ ok: false, reason: "OPEN_FAILED" });
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(logError.mock.calls).toEqual([["WhatsApp chat launch attempt failed."], ["WhatsApp chat launch attempt failed."]]);
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(/57300|secreto|wa\.me|whatsapp:/u);
  });

  it("launches nothing for an invalid target or an over-long text", async () => {
    const { launcher, openExternal } = create(async () => undefined);
    await expect(launcher.open({ digits: "12", body: "hola" })).resolves.toEqual({ ok: false, reason: "INVALID_TARGET" });
    await expect(launcher.open({ digits: DIGITS, body: "a".repeat(3000) })).resolves.toEqual({ ok: false, reason: "TOO_LONG" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("answers whether a text fits without needing a number", () => {
    const { launcher } = create(async () => undefined);
    expect(launcher.canCarry("hola")).toBe(true);
    expect(launcher.canCarry("a".repeat(1000))).toBe(true);
    expect(launcher.canCarry("😀".repeat(200))).toBe(false);
  });

  it("uses the Electron shell by default", async () => {
    await expect(createWhatsAppChatLauncher().open({ digits: DIGITS, body: "hola" })).resolves.toEqual({ ok: true });
    expect(shell.openExternal).toHaveBeenCalledWith(`whatsapp://send?phone=${DIGITS}&text=hola`);
  });
});

const createFlow = (options: Parameters<typeof createFakeMessagingFlow>[0] = {}) => {
  const flow = createFakeMessagingFlow(options);
  const unused = { execute: vi.fn() } as never;
  const executorLog = vi.fn();
  const executor = createActionExecutor({
    plannerExecutor: unused,
    applicationExecutor: unused,
    approvedWebExecutor: unused,
    filesExecutor: unused,
    messagingExecutor: createMessagingActionExecutor({ service: flow.service, logError: executorLog })
  });
  const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
  let counter = 0;
  const orchestratorLog = vi.fn();
  const orchestrator = createActionOrchestrator({
    executor,
    historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
    generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: orchestratorLog
  });
  flow.seed("Mamá", DIGITS);
  return { ...flow, orchestrator, recordTerminal, executorLog, orchestratorLog };
};

type Flow = ReturnType<typeof createFlow>;

const prepareDraft = (flow: Flow, body = "llego en diez minutos") =>
  flow.orchestrator.propose({ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body, channel: "WHATSAPP" } });

const confirmationOf = (result: Awaited<ReturnType<Flow["orchestrator"]["propose"]>>) => {
  if (!result.ok || !("confirmationId" in result.data)) throw new Error("Expected a confirmation.");
  return result.data;
};

const everythingRecorded = (flow: Flow): string =>
  JSON.stringify([flow.recordTerminal.mock.calls, flow.logError.mock.calls, flow.executorLog.mock.calls, flow.orchestratorLog.mock.calls]);

const REVIEW =
  "Se abrirá un chat de WhatsApp con «Mamá» (número •••• 4567) con este mensaje: «llego en diez minutos». WhatsApp se abrirá y tendrás que pulsar enviar tú; Ares no envía nada.";

describe("confirmed chat opening", () => {
  it("requires a standard confirmation showing the name, the masked number and the exact text", async () => {
    const flow = createFlow();
    await prepareDraft(flow);

    const proposed = await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} });
    const awaiting = confirmationOf(proposed);

    expect(awaiting).toMatchObject({
      action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT",
      riskLevel: 2,
      confirmation: { required: true, summary: REVIEW, scopeSummary: "Chat de WhatsApp" }
    });
    expect(JSON.stringify(proposed)).not.toMatch(/573001234567|3001234567|wa\.me|whatsapp:|preparedId/u);
    expect(flow.open).not.toHaveBeenCalled();
    expect(flow.service.hasActiveDraft()).toBe(true);
  });

  it("opens once after confirmation, tells the person to press send, and clears the draft", async () => {
    const flow = createFlow();
    await prepareDraft(flow);
    const awaiting = confirmationOf(await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }));

    const confirmed = await flow.orchestrator.confirm(awaiting.confirmationId);

    expect(confirmed).toMatchObject({
      ok: true,
      data: {
        status: "SUCCEEDED",
        userSummary: "Abrí el chat con Mamá. Revisa el mensaje y pulsa enviar.",
        data: { kind: "CHAT_OPENED", recipientName: "Mamá" }
      }
    });
    expect(JSON.stringify(confirmed)).not.toMatch(/573001234567|llego en diez|wa\.me|whatsapp:/u);
    expect(flow.open).toHaveBeenCalledTimes(1);
    expect(flow.open).toHaveBeenCalledWith({ digits: DIGITS, body: "llego en diez minutos" });
    expect(flow.service.hasActiveDraft()).toBe(false);

    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
    const repeated = await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} });
    expect(repeated).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_NO_DRAFT" } });
    expect(repeated.ok && "lifecycleState" in repeated.data).toBe(false);
    expect(flow.open).toHaveBeenCalledTimes(1);
  });

  it("asks for a draft first without a dialog or a launch", async () => {
    const flow = createFlow();
    const result = await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_NO_DRAFT", userSummary: MESSAGING_FAILURES.MESSAGING_NO_DRAFT }
    });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(flow.open).not.toHaveBeenCalled();
  });

  it("launches nothing and keeps the draft when the review is cancelled", async () => {
    const flow = createFlow();
    await prepareDraft(flow);
    const awaiting = confirmationOf(await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }));
    await flow.orchestrator.cancel(awaiting.confirmationId);
    expect(flow.open).not.toHaveBeenCalled();
    expect(flow.service.hasActiveDraft()).toBe(true);
    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
  });

  it("accepts no number, link, identifier or flag from a caller", async () => {
    const flow = createFlow();
    await prepareDraft(flow);
    for (const input of [{ phone: "3001234567" }, { url: "https://wa.me/1" }, { preparedId: "00000000-0000-4000-8000-000000000001" }, { confirmed: true }, "x"]) {
      await expect(flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input })).resolves.toMatchObject({
        ok: false, error: { code: "ACTION_PROPOSAL_INVALID" }
      });
    }
    expect(flow.open).not.toHaveBeenCalled();
  });

  describe("re-validation at confirmation", () => {
    const review = async (flow: Flow) => {
      await prepareDraft(flow);
      return confirmationOf(await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }));
    };

    it("aborts with its own message when the draft was replaced after the review", async () => {
      const flow = createFlow();
      const awaiting = await review(flow);
      await prepareDraft(flow, "otro texto");

      await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
        ok: true,
        data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_DRAFT_CHANGED", userSummary: MESSAGING_FAILURES.MESSAGING_DRAFT_CHANGED }
      });
      expect(flow.open).not.toHaveBeenCalled();
      expect(flow.service.getActiveDraft()).toMatchObject({ body: "otro texto" });
    });

    it("aborts when the text was edited after the review", async () => {
      const flow = createFlow();
      const awaiting = await review(flow);
      await flow.orchestrator.propose({ action: "EDIT_MESSAGE_DRAFT", input: { body: "editado" } });
      await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
        ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_DRAFT_CHANGED" }
      });
      expect(flow.open).not.toHaveBeenCalled();
    });

    it("aborts when the draft was discarded or expired", async () => {
      const discarded = createFlow();
      const first = await review(discarded);
      await discarded.orchestrator.propose({ action: "DISCARD_MESSAGE_DRAFT", input: {} });
      await expect(discarded.orchestrator.confirm(first.confirmationId)).resolves.toMatchObject({
        ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_NO_DRAFT" }
      });

      const expired = createFlow();
      const second = await review(expired);
      // The review snapshot lives five minutes, shorter than the ten-minute draft, so it expires first.
      expired.advance(10 * 60 * 1000);
      await expect(expired.orchestrator.confirm(second.confirmationId)).resolves.toMatchObject({
        ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_PENDING_EXPIRED" }
      });
      expect(expired.service.hasActiveDraft()).toBe(false);
      expect(discarded.open).not.toHaveBeenCalled();
      expect(expired.open).not.toHaveBeenCalled();
    });

    it("aborts and clears the draft when the contact was deleted", async () => {
      const flow = createFlow();
      const awaiting = await review(flow);
      flow.contacts.clear();
      await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
        ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_NOT_FOUND" }
      });
      expect(flow.service.hasActiveDraft()).toBe(false);
      expect(flow.open).not.toHaveBeenCalled();
    });

    it("aborts when the stored number is no longer valid", async () => {
      const flow = createFlow();
      const awaiting = await review(flow);
      for (const contact of flow.contacts.values()) contact.phoneDigits = "123";
      await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
        ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_INVALID_PHONE" }
      });
      expect(flow.open).not.toHaveBeenCalled();
    });
  });

  it("refuses to review a text that cannot fit the link, without a dialog", async () => {
    const flow = createFlow({ canCarry: false });
    await prepareDraft(flow, "😀".repeat(300));
    const result = await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_BODY_TOO_LONG_FOR_LINK", userSummary: MESSAGING_FAILURES.MESSAGING_BODY_TOO_LONG_FOR_LINK }
    });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
  });

  it("reports a failed launch with its own message, keeps the draft and never claims success", async () => {
    const flow = createFlow({ launch: { ok: false, reason: "OPEN_FAILED" } });
    await prepareDraft(flow);
    const awaiting = confirmationOf(await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }));

    const failed = await flow.orchestrator.confirm(awaiting.confirmationId);

    expect(failed).toMatchObject({
      ok: true,
      data: { status: "EXECUTION_FAILED", errorCode: "MESSAGING_OPEN_FAILED", userSummary: "No pude abrir WhatsApp. Revisa que esté instalado." }
    });
    expect(JSON.stringify(failed)).not.toMatch(/Abrí el chat/u);
    expect(flow.service.hasActiveDraft()).toBe(true);
  });

  it("maps a launcher that is too long or throws to fixed failures", async () => {
    const tooLong = createFlow({ launch: { ok: false, reason: "TOO_LONG" } });
    await prepareDraft(tooLong);
    const first = confirmationOf(await tooLong.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }));
    await expect(tooLong.orchestrator.confirm(first.confirmationId)).resolves.toMatchObject({
      ok: true, data: { errorCode: "MESSAGING_BODY_TOO_LONG_FOR_LINK" }
    });

    const throwing = createFlow();
    throwing.open.mockRejectedValueOnce(new Error("https://wa.me/573001234567?text=secreto"));
    await prepareDraft(throwing, "secreto");
    const second = confirmationOf(await throwing.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }));
    const result = await throwing.orchestrator.confirm(second.confirmationId);
    expect(result).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", errorCode: "MESSAGING_OPEN_FAILED" } });
    expect(JSON.stringify([result, throwing.logError.mock.calls])).not.toMatch(/57300|secreto|wa\.me/u);
  });

  it("keeps the number, the text, the name and the link out of history, logs and speech", async () => {
    const flow = createFlow();
    await prepareDraft(flow, "texto privado 12345");
    const awaitingResult = await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} });
    const remembered: string[] = [];
    const responses = { clear: vi.fn(), remember: vi.fn((_id: number, text: string) => { remembered.push(text); return {} as never; }) };
    attachSpokenActionResponse(1, awaitingResult, responses);
    expect(remembered).toEqual([]);

    const awaiting = confirmationOf(awaitingResult);
    const confirmed = await flow.orchestrator.confirm(awaiting.confirmationId);
    attachSpokenActionResponse(1, confirmed, responses);

    expect(remembered).toEqual(["Abrí el chat con Mamá. Revisa el mensaje y pulsa enviar."]);
    expect(everythingRecorded(flow)).not.toMatch(/Mamá|privado|12345|4567|57300|wa\.me|whatsapp:/u);
    expect(flow.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT",
      status: "SUCCEEDED",
      userSummary: "La acción de mensajería se completó.",
      metadata: { scopeKind: "MESSAGING", resultKind: "SUCCEEDED" }
    }));
  });

  it("speaks the fixed failure text only", async () => {
    const flow = createFlow({ launch: { ok: false, reason: "OPEN_FAILED" } });
    await prepareDraft(flow);
    const awaiting = confirmationOf(await flow.orchestrator.propose({ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }));
    const failed = await flow.orchestrator.confirm(awaiting.confirmationId);
    const remembered: string[] = [];
    attachSpokenActionResponse(1, failed, { clear: vi.fn(), remember: (_id: number, text: string) => { remembered.push(text); return {} as never; } } as never);
    expect(remembered).toEqual([MESSAGING_FAILURES.MESSAGING_OPEN_FAILED]);
  });
});

describe("openExternal stays inside the one launcher module", () => {
  const listSources = (directory: string): string[] =>
    readdirSync(path.resolve(process.cwd(), directory), { recursive: true, encoding: "utf8" })
      .filter((entry) => /\.tsx?$/u.test(entry))
      .map((entry) => path.join(directory, entry));

  it("appears among the messaging files only in whatsapp-chat-launcher.ts", () => {
    const messagingFiles = [
      ...listSources("src/main/messaging"),
      "src/main/actions/messaging-action-executor.ts",
      "src/main/assistant/messaging-phrases.ts",
      "src/main/ipc/register-messaging-ipc.ts",
      "src/shared/messaging-contracts.ts",
      "src/preload/preload.ts",
      ...listSources("src/renderer")
    ];
    const using = messagingFiles.filter((file) => source(file).includes("openExternal"));
    expect(using.map((file) => path.basename(file))).toEqual(["whatsapp-chat-launcher.ts"]);
  });

  it("is imported by the composition only and is the only messaging file with a link template", () => {
    const importers = listSources("src").filter((file) => /whatsapp-chat-launcher["']/u.test(source(file)));
    expect(importers.map((file) => path.basename(file)).sort()).toEqual(["messaging-composition.ts", "messaging-service.ts"]);
    expect(source("src/main/messaging/messaging-service.ts")).toMatch(/import type \{ WhatsAppChatLauncher \}/u);
    for (const file of [...listSources("src/main/messaging"), "src/main/actions/messaging-action-executor.ts", "src/main/assistant/messaging-phrases.ts", "src/main/ipc/register-messaging-ipc.ts"]) {
      if (file.endsWith("whatsapp-chat-launcher.ts")) continue;
      expect(source(file)).not.toMatch(/wa\.me|whatsapp:\/\/|encodeURIComponent|https?:\/\//u);
    }
  });

  it("makes no network request and has no process or filesystem capability in the launcher", () => {
    const launcher = source("src/main/messaging/whatsapp-chat-launcher.ts");
    expect(launcher).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|node:http|node:net|child_process|\bspawn\(|node:fs|node:path|sendInput|keyboard|robot/u);
    expect(launcher.match(/shell\.openExternal\(/gu)?.length).toBe(1);
    for (const call of launcher.match(/logError\([^)]*\)/gu) ?? []) expect(call).toMatch(/logError\("[^"$]*"\)/u);
  });

  it("registers exactly seven MESSAGING actions", async () => {
    const { ENABLED_ASSISTANT_CAPABILITIES } = await import("../src/main/actions/capability-registry");
    expect(ENABLED_ASSISTANT_CAPABILITIES.filter((capability) => capability.domain === "MESSAGING")).toHaveLength(7);
  });
});

export type { FakeMessagingFlow };
