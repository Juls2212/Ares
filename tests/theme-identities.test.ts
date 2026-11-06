import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssistantInterpretation } from "../src/shared/assistant-contracts";
import type { AwaitingActionConfirmation } from "../src/shared/action-contracts";
import {
  createGuidanceRotation,
  GUIDANCE_INTERVAL_MS,
  greetingForHour,
  IDLE_GUIDANCE_PHRASES,
  nextGuidanceIndex
} from "../src/renderer/features/assistant/idle-guidance";
import { RESPONSE_AREA_LABELS, responseAreaFor, responseAreaLabel } from "../src/renderer/features/assistant/response-area";
import { AresView } from "../src/renderer/views/ares-view";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
const css = source("src/renderer/styles/ares-glass.css");
const blockOf = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing block ${selector}`);
  return css.slice(start, css.indexOf("\n}", start));
};
const tokensOf = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2].trim()]));
const viewProperties = {
  technicalState: "SUCCESS" as const,
  voiceLabel: "Listo para grabar",
  voiceState: "IDLE" as const,
  orbState: "idle" as const,
  isInterpreting: false,
  draftStates: {},
  onStartRecording: vi.fn(),
  onCancelRecording: vi.fn(),
  onPropose: vi.fn(),
  onResolveConfirmation: vi.fn()
};

const confirmation: AwaitingActionConfirmation = {
  lifecycleState: "AWAITING_CONFIRMATION",
  actionId: "action-1",
  action: "OPEN_FOUND_FILE",
  riskLevel: 2,
  confirmationId: "confirmation-1",
  confirmation: { required: true, summary: "Se abrirá el archivo.", affectedItemCount: 1, scopeSummary: "Resultado de búsqueda" }
};
const interpretationFor = (...actions: string[]): AssistantInterpretation =>
  ({ state: "READY", summary: "Listo.", drafts: actions.map((action) => ({ action, input: {} })), clarifications: [] }) as unknown as AssistantInterpretation;

describe("idle guidance", () => {
  afterEach(() => vi.useRealTimers());

  it("lists the six Spanish example phrases", () => {
    expect(IDLE_GUIDANCE_PHRASES).toEqual([
      "Prueba: “Abre Spotify”",
      "Prueba: “Busca un archivo llamado informe”",
      "Prueba: “Pon música de Soda Stereo”",
      "Prueba: “Escríbele a Mamá que llego tarde”",
      "Prueba: “Crea una carpeta llamada Fotos”",
      "Prueba: “¿Qué contactos tengo?”"
    ]);
    expect(GUIDANCE_INTERVAL_MS).toBe(6_000);
    expect(nextGuidanceIndex(5)).toBe(0);
    expect(nextGuidanceIndex(0)).toBe(1);
  });

  it("renders only at rest: decorative, with no response, card or shortcut hint", () => {
    const resting = renderToStaticMarkup(createElement(AresView, viewProperties));
    expect(resting).toContain('<div aria-hidden="true" class="idle-guidance">');
    expect(resting).toContain(IDLE_GUIDANCE_PHRASES[0]!);
    const withHint = renderToStaticMarkup(createElement(AresView, { ...viewProperties, shortcutHint: "Atajo: Ctrl+Alt+Espacio" }));
    expect(withHint).not.toContain("idle-guidance");
    expect(withHint).toContain("shortcut-hint");
    const withResponse = renderToStaticMarkup(createElement(AresView, { ...viewProperties, spokenResponse: { responseId: "r", text: "Hola" } }));
    expect(withResponse).not.toContain("idle-guidance");
    const withCard = renderToStaticMarkup(createElement(AresView, { ...viewProperties, interpretation: interpretationFor("OPEN_FOUND_FILE"), draftStates: { 0: { busy: false, resolved: true, confirmation } } }));
    expect(withCard).not.toContain("idle-guidance");
    expect(withCard).not.toContain("command-text__greeting");
    for (const active of [{ voiceState: "RECORDING" as const, orbState: "recording" as const }, { voiceState: "PROCESSING" as const, orbState: "transcribing" as const }]) {
      expect(renderToStaticMarkup(createElement(AresView, { ...viewProperties, ...active }))).not.toContain("idle-guidance");
    }
    expect(renderToStaticMarkup(createElement(AresView, { ...viewProperties, voiceMessage: "No se pudo acceder al micrófono." }))).not.toContain("idle-guidance");
  });

  it("rotates on a timer and stops while the document is hidden", () => {
    vi.useFakeTimers();
    let hidden = false;
    let notify = (): void => undefined;
    const advance = vi.fn();
    const stop = createGuidanceRotation({ onAdvance: advance, isHidden: () => hidden, subscribeVisibility: (listener) => { notify = listener; return () => { notify = () => undefined; }; } });
    vi.advanceTimersByTime(GUIDANCE_INTERVAL_MS * 2);
    expect(advance).toHaveBeenCalledTimes(2);
    hidden = true;
    notify();
    vi.advanceTimersByTime(GUIDANCE_INTERVAL_MS * 3);
    expect(advance).toHaveBeenCalledTimes(2);
    hidden = false;
    notify();
    vi.advanceTimersByTime(GUIDANCE_INTERVAL_MS);
    expect(advance).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(GUIDANCE_INTERVAL_MS * 5);
    expect(advance).toHaveBeenCalledTimes(3);
  });

  it("starts paused when the document is already hidden", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const stop = createGuidanceRotation({ onAdvance: advance, isHidden: () => true, subscribeVisibility: () => () => undefined });
    vi.advanceTimersByTime(GUIDANCE_INTERVAL_MS * 4);
    expect(advance).not.toHaveBeenCalled();
    stop();
  });

  it("cross-fades with opacity only, swaps without animation under reduced motion, and keeps text readable", () => {
    expect(blockOf(".idle-guidance__item")).toContain("animation: ares-fade-in 400ms ease-out both;");
    expect(blockOf(".idle-guidance__item")).not.toMatch(/transition|transform|top:\s*\d|left:\s*\d/u);
    expect(css).toContain(".idle-guidance__item[data-leaving] { animation: ares-fade-out 400ms ease-in both; }");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@keyframes ares-fade-in"));
    expect(reduced).toContain(".idle-guidance__item { animation: none; }");
    expect(reduced).toContain(".idle-guidance__item[data-leaving] { display: none; }");
    expect(css.slice(css.indexOf("@media (forced-colors: active)"))).toContain(".idle-guidance__item");
    expect(blockOf(".idle-guidance__item")).not.toMatch(/opacity\s*:/u);
  });

  it("never overlaps the shortcut hint or the response area by geometry", () => {
    expect(blockOf(".command-text")).toContain("bottom: 14cqw;");
    expect(blockOf(".shortcut-hint")).toContain("bottom: 5cqw;");
    expect(blockOf(".idle-guidance")).toContain("height: 16px;");
  });
});

describe("greeting helper", () => {
  it("follows the hour bands with no personal name", () => {
    const expected: Array<[number, string]> = [[0, "Buenas noches"], [4, "Buenas noches"], [5, "Buenos días"], [11, "Buenos días"], [12, "Buenas tardes"], [19, "Buenas tardes"], [20, "Buenas noches"], [23, "Buenas noches"]];
    for (const [hour, text] of expected) expect(greetingForHour(hour), String(hour)).toBe(text);
  });

});

describe("response context chip", () => {
  it("maps the typed action names to a fixed Spanish area label", () => {
    expect(RESPONSE_AREA_LABELS).toEqual({ APPLICATIONS: "Aplicaciones", FILES: "Archivos", MUSIC: "Música", MESSAGING: "Mensajes", WEB: "Web" });
    const cases: Array<[string, string]> = [
      ["OPEN_APPLICATION", "Aplicaciones"], ["SEARCH_FILES", "Archivos"], ["DELETE_FOUND_ITEM", "Archivos"], ["PLAY_SPOTIFY_MUSIC", "Música"],
      ["WHAT_IS_PLAYING", "Música"], ["PREPARE_MESSAGE_DRAFT", "Mensajes"], ["LIST_CONTACTS", "Mensajes"], ["OPEN_WEB_PAGE", "Web"], ["SEARCH_APPROVED_SITE", "Web"]
    ];
    for (const [action, label] of cases) expect(responseAreaLabel(interpretationFor(action)), action).toBe(label);
  });

  it("is absent when the area is unknown, mixed or there are no drafts", () => {
    expect(responseAreaFor(undefined)).toBeUndefined();
    expect(responseAreaFor(interpretationFor())).toBeUndefined();
    expect(responseAreaFor(interpretationFor("CREATE_TASK"))).toBeUndefined();
    expect(responseAreaFor(interpretationFor("GET_WEATHER"))).toBeUndefined();
    expect(responseAreaFor(interpretationFor("OPEN_APPLICATION", "SEARCH_FILES"))).toBeUndefined();
    expect(responseAreaFor(interpretationFor("OPEN_APPLICATION", "CREATE_TASK"))).toBeUndefined();
  });

  it("only ever shows the fixed label: never names, queries, numbers or message text, and no memory area exists", () => {
    const area = source("src/renderer/features/assistant/response-area.ts");
    expect(area).not.toMatch(/\.input|summary|spokenResponse|\.text|displayName|phone/u);
    expect(Object.values(RESPONSE_AREA_LABELS).join(" ")).not.toMatch(/\d|@|\//u);
    const view = source("src/renderer/views/ares-view.tsx");
    expect(view).toContain("const areaLabel = showResponse ? responseAreaLabel(interpretation) : undefined;");
    expect(view).toContain('{areaLabel && <p className="command-text__chip">{areaLabel}</p>}');
    expect(view.indexOf("command-text__chip")).toBeLessThan(view.indexOf('className="command-response"'));
    expect(blockOf(".command-text__chip")).toContain("border-radius: 999px;");
    expect(css.slice(css.indexOf("@media (forced-colors: active)"))).toContain(".command-text__chip");
  });
});
