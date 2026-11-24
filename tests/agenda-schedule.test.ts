import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, app: { getPath: vi.fn() }, shell: {}, dialog: {} }));

import { DISPLAYED_AGENDA_ITEMS, SPOKEN_AGENDA_ITEMS, dayLabel, describeSchedule } from "../src/main/actions/agenda-text";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { attachSpokenActionResponse } from "../src/main/ipc/register-action-ipc";
import { createPlannerService, type PlannerClock } from "../src/main/planner/planner-service";
import { validateGetTodayScheduleInput } from "../src/main/planner/planner-validation";
import { createSpeechService } from "../src/main/voice/speech-service";
import { SPOKEN_CAP_AGENDA, SPOKEN_CAP_DEFAULT, capSpokenText } from "../src/main/voice/spoken-text-cap";
import type { TodayScheduleData } from "../src/shared/planner-contracts";
import { AGENDA_TEXT_CHARACTERS } from "../src/shared/speech-contracts";

const NOW = new Date("2026-09-20T15:00:00.000Z"); // Sunday 10:00 in Bogota
const ZONE = "America/Bogota";

const data = (overrides: Partial<TodayScheduleData> = {}): TodayScheduleData => ({ localDate: "2026-09-21", tasks: [], events: [], reminders: [], ...overrides });
const event = (title: string, startAt: string) => ({ id: "e", title, startAt }) as never;
const task = (title: string, dueTime: string | null) => ({ id: "t", title, dueTime, priority: "LOW", status: "PENDING" }) as never;
const reminder = (title: string, remindAt: string) => ({ id: "r", title, remindAt }) as never;

describe("agenda wording", () => {
  it("says what is scheduled tomorrow, in time order, with 12-hour times and the day period", () => {
    const texts = describeSchedule(data({
      events: [event("reunión con el equipo", "2026-09-21T14:00:00.000Z"), event("entregar el informe", "2026-09-21T20:00:00.000Z")],
      reminders: [reminder("llamar a mamá", "2026-09-21T22:00:00.000Z")]
    }), NOW, ZONE);
    expect(texts.display).toBe("Mañana tienes 3 cosas: a las 9 de la mañana, reunión con el equipo; a las 3 de la tarde, entregar el informe; y un recordatorio a las 5 de la tarde, llamar a mamá.");
    expect(texts.spoken).toBe(texts.display);
  });

  it("says an empty day, with the right day word", () => {
    expect(describeSchedule(data(), NOW, ZONE).display).toBe("Mañana no tienes nada programado.");
    expect(describeSchedule(data({ localDate: "2026-09-20" }), NOW, ZONE).spoken).toBe("Hoy no tienes nada programado.");
  });

  it("puts timed items first and items without a time after them", () => {
    const texts = describeSchedule(data({ tasks: [task("Comprar pan", null), task("Pagar luz", "08:00")], events: [event("Cita", "2026-09-21T19:30:00.000Z")] }), NOW, ZONE);
    expect(texts.display).toBe("Mañana tienes 3 cosas: a las 8 de la mañana, la tarea Pagar luz; a las 2 y media de la tarde, Cita; y la tarea Comprar pan.");
  });

  it("uses «una cosa» for one item", () => {
    expect(describeSchedule(data({ tasks: [task("Comprar pan", null)] }), NOW, ZONE).display).toBe("Mañana tienes una cosa: la tarea Comprar pan.");
  });

  it("speaks the first 5 items then «y N más», while the screen shows up to 12", () => {
    const events = Array.from({ length: 14 }, (_, index) => event(`Cita ${index + 1}`, `2026-09-21T${String(13 + index % 10).padStart(2, "0")}:${index < 10 ? "00" : "30"}:00.000Z`));
    const texts = describeSchedule(data({ events }), NOW, ZONE);
    expect(SPOKEN_AGENDA_ITEMS).toBe(5);
    expect(DISPLAYED_AGENDA_ITEMS).toBe(12);
    expect(texts.spoken).toMatch(/^Mañana tienes 14 cosas: .*; y 9 más\.$/u);
    expect(texts.spoken.split(";")).toHaveLength(6); // five items and the final «y 9 más» part
    expect(texts.display).toMatch(/; y 2 más\.$/u);
    expect(texts.display.match(/Cita \d+/gu)).toHaveLength(12);
    expect(texts.spoken.match(/Cita \d+/gu)).toHaveLength(5);
  });

  it("trims very long titles so the text stays bounded", () => {
    const texts = describeSchedule(data({ tasks: [task("x".repeat(500), null)] }), NOW, ZONE);
    expect(texts.display.length).toBeLessThan(120);
    expect(texts.display).toContain("…");
  });

  it("labels days near and far", () => {
    expect(dayLabel("2026-09-20", NOW, ZONE)).toBe("Hoy");
    expect(dayLabel("2026-09-21", NOW, ZONE)).toBe("Mañana");
    expect(dayLabel("2026-09-22", NOW, ZONE)).toBe("Pasado mañana");
    expect(dayLabel("2026-09-25", NOW, ZONE)).toBe("El viernes 25 de septiembre");
  });
});

describe("spoken cap override for agendas", () => {
  const sentence = (index: number) => `Frase número ${index} de la agenda con algo de texto para ocupar espacio.`;
  const longText = Array.from({ length: 10 }, (_, index) => sentence(index + 1)).join(" ");

  it("keeps the normal cap for everything else and uses a named, bounded cap for an agenda", () => {
    expect(SPOKEN_CAP_DEFAULT).toEqual({ maxSentences: 2, maxCharacters: 240 });
    expect(SPOKEN_CAP_AGENDA).toEqual({ maxSentences: 6, maxCharacters: 600 });
    expect(capSpokenText(longText).match(/Frase número/gu)).toHaveLength(2);
    const agenda = capSpokenText(longText, SPOKEN_CAP_AGENDA);
    expect(agenda.length).toBeLessThanOrEqual(600);
    expect(agenda.endsWith(".")).toBe(true);
    expect(agenda.match(/Frase número/gu)!.length).toBeGreaterThan(2);
    expect(agenda.match(/Frase número/gu)!.length).toBeLessThanOrEqual(6);
  });

  it("never cuts inside a sentence", () => {
    const agenda = capSpokenText(longText, SPOKEN_CAP_AGENDA);
    for (const part of agenda.split(/(?<=\.)\s+/u)) expect(longText).toContain(part);
  });

  it("is applied by the speech service only to an agenda response, using its spoken text, while the screen text stays full", async () => {
    const provider = vi.fn(async () => ({ audio: new Uint8Array([1]).buffer, mimeType: "audio/mpeg" as const }));
    const service = createSpeechService(() => provider);
    const screen = Array.from({ length: 5 }, (_, index) => sentence(index + 1)).join(" ");
    const spoken = Array.from({ length: 4 }, (_, index) => sentence(index + 1)).join(" ");
    const response = service.remember(1, screen, { spokenText: spoken, agenda: true })!;
    expect(response.text).toBe(screen);
    await service.speak(1, { responseId: response.responseId });
    expect(provider).toHaveBeenLastCalledWith(spoken, expect.anything());
    const ordinary = service.remember(1, screen)!;
    await service.speak(1, { responseId: ordinary.responseId });
    expect(provider).toHaveBeenLastCalledWith(`${sentence(1)} ${sentence(2)}`, expect.anything());
  });

  it("accepts an agenda text longer than an ordinary response, up to its own bound only", () => {
    const service = createSpeechService(() => vi.fn());
    expect(service.remember(1, "x".repeat(401))).toBeUndefined();
    expect(service.remember(1, "x".repeat(900), { agenda: true })).toBeDefined();
    expect(service.remember(1, "x".repeat(AGENDA_TEXT_CHARACTERS + 1), { agenda: true })).toBeUndefined();
  });
});

describe("what is spoken and shown, and what is not persisted", () => {
  const outcome = {
    actionId: "a", action: "GET_TODAY_SCHEDULE", riskLevel: 1, status: "SUCCEEDED",
    userSummary: "Mañana tienes 6 cosas: a las 9 de la mañana, Cita con Sofía 3001234567; y 5 más.",
    data: { localDate: "2026-09-21", tasks: [], events: [], reminders: [], spokenSummary: "Mañana tienes 6 cosas: a las 9 de la mañana, Cita con Sofía 3001234567." }
  };

  it("remembers the on-screen text for display and the shorter text for speech, with the agenda option", () => {
    const remember = vi.fn(() => ({ responseId: "r", text: outcome.userSummary }));
    const result = attachSpokenActionResponse(1, { ok: true, data: structuredClone(outcome) as never }, { clear: vi.fn(), remember });
    expect(remember).toHaveBeenCalledExactlyOnceWith(1, outcome.userSummary, { spokenText: outcome.data.spokenSummary, agenda: true });
    expect((result as { data: { userSummary: string } }).data.userSummary).toBe(outcome.userSummary);
  });

  it("does not use the agenda path for other actions or failed outcomes", () => {
    const remember = vi.fn(() => undefined);
    attachSpokenActionResponse(1, { ok: true, data: { ...structuredClone(outcome), action: "GET_CURRENT_DATE_TIME" } as never }, { clear: vi.fn(), remember });
    expect(remember).toHaveBeenCalledWith(1, outcome.userSummary);
  });

  it("keeps the generic sentence in history: source check of the fixed persisted text", () => {
    const orchestrator = readFileSync("src/main/actions/action-orchestrator.ts", "utf8");
    expect(orchestrator).toContain('GET_TODAY_SCHEDULE: "Se consultó la agenda.",');
    expect(orchestrator).toContain("PLANNER_HISTORY_SUMMARIES[outcome.action as PlannerActionProposal[\"action\"]]");
  });
});

describe("the agenda input", () => {
  it("accepts an optional ISO date and still rejects extra fields and malformed dates", () => {
    expect(validateGetTodayScheduleInput({})).toMatchObject({ ok: true, data: {} });
    expect(validateGetTodayScheduleInput({ date: "2026-09-21" })).toMatchObject({ ok: true, data: { date: "2026-09-21" } });
    for (const hostile of [{ date: "mañana" }, { date: "2026-02-30" }, { date: 5 }, { day: "2026-09-21" }, { date: "2026-09-21", extra: true }, { dayOffset: 1 }]) {
      expect(validateGetTodayScheduleInput(hostile)).toMatchObject({ ok: false });
    }
  });

  it("the planner service reads the asked day, and rejects a day before today or more than 14 days ahead", async () => {
    const clock: PlannerClock = { getLocalDate: () => "2026-09-20", getRangeBounds: (startDate) => ({ startAt: `${startDate}T05:00:00.000Z`, endAt: `${startDate}T23:00:00.000Z` }) };
    const listTasks = vi.fn(async () => []);
    const listEvents = vi.fn(async () => []);
    const listReminders = vi.fn(async () => []);
    const service = createPlannerService({ repositories: { listTasks, listEvents, listReminders } as never, clock, logError: vi.fn() });
    await expect(service.getTodaySchedule({ date: "2026-09-22" })).resolves.toMatchObject({ ok: true, data: { localDate: "2026-09-22" } });
    expect(listTasks).toHaveBeenLastCalledWith({ dueDateFrom: "2026-09-22", dueDateTo: "2026-09-22", includeCompleted: false });
    await expect(service.getTodaySchedule({ date: "2026-10-04" })).resolves.toMatchObject({ ok: true });
    for (const date of ["2026-10-05", "2026-09-19"]) await expect(service.getTodaySchedule({ date })).resolves.toMatchObject({ ok: false, error: { code: "PLANNER_DATE_INVALID" } });
    await expect(service.getTodaySchedule({})).resolves.toMatchObject({ ok: true, data: { localDate: "2026-09-20" } });
  });
});

describe("the interpreter and the agenda or an ambiguous hour", () => {
  const reference = { now: "2026-09-20T15:00:00.000Z", timeZone: ZONE, knownApplicationAliases: [], knownCatalogApplications: [] };
  const interpret = (action: string, input: unknown, instruction: string) => createAssistantInterpreter({
    getConfiguration: () => ({ apiKey: "", model: "" }),
    createProvider: () => ({ interpret: async () => JSON.stringify({ state: "READY", summary: "x", responseText: "", clarifications: [], drafts: [{ action, input: JSON.stringify(input), approvedWeb: null }] }) }),
    now: () => new Date(reference.now), timeZone: () => reference.timeZone
  }).interpret({ instruction }, reference);

  it("resolves «mañana» for the agenda to a real date from Main's clock", async () => {
    await expect(interpret("GET_TODAY_SCHEDULE", { date: "mañana" }, "qué tengo mañana")).resolves.toMatchObject({
      ok: true, data: { state: "READY", drafts: [{ action: "GET_TODAY_SCHEDULE", input: { date: "2026-09-21" } }] }
    });
    await expect(interpret("GET_TODAY_SCHEDULE", {}, "qué tengo hoy")).resolves.toMatchObject({ ok: true, data: { state: "READY", drafts: [{ input: {} }] } });
  });

  it("asks a bounded Spanish question for a day that is out of range, past or ambiguous", async () => {
    const question = async (date: string) => (await interpret("GET_TODAY_SCHEDULE", { date }, "agenda")) as { data: { state: string; clarifications: Array<{ question: string }> } };
    expect((await question("2027-01-01")).data).toMatchObject({ state: "NEEDS_CLARIFICATION", clarifications: [{ question: "Solo puedo consultar los próximos 14 días. ¿Qué día quieres?" }] });
    expect((await question("2026-09-19")).data.clarifications[0]!.question).toBe("Solo puedo consultar desde hoy en adelante. ¿Qué día quieres?");
    expect((await question("domingo")).data.clarifications[0]!.question).toBe("¿Hoy o el próximo? Dime la fecha exacta.");
    expect((await question("cuando sea")).data.clarifications[0]!.question).toContain("¿De qué día quieres la agenda?");
  });

  it("asks «¿A las 5 de la mañana o de la tarde?» instead of choosing", async () => {
    const result = await interpret("CREATE_REMINDER", { title: "Llamar", date: "mañana", time: "a las 5" }, "recuérdame mañana a las 5 llamar");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", clarifications: [{ question: "¿A las 5 de la mañana o de la tarde?" }] } });
  });

  it("creates the reminder once the day period is said", async () => {
    const result = await interpret("CREATE_REMINDER", { title: "Llamar", date: "mañana", time: "5 de la tarde" }, "recuérdame mañana a las 5 de la tarde llamar");
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "CREATE_REMINDER", input: { remindAt: "2026-09-21T22:00:00.000Z" } }] } });
  });
});

describe("prompt and labels", () => {
  const provider = readFileSync("src/main/assistant/openai-structured-provider.ts", "utf8");

  it("tells the model to copy the time as said, and to use the one agenda action for any near day", () => {
    expect(provider).toContain("cópiala, no la conviertas a 24 horas por tu cuenta");
    expect(provider).toContain('input {\\"date\\":\\"mañana\\"}');
    expect(provider).toContain("no uses GET_WEEK_SCHEDULE para un solo día");
    expect(provider).not.toContain('\\"dueTime\\":\\"18:00\\"');
  });

  it("labels the capability as covering any near day", () => {
    expect(readFileSync("src/main/actions/capability-registry.ts", "utf8")).toContain("Consultar la agenda de un día cercano");
    expect(readFileSync("docs/CAPABILITIES.md", "utf8")).toContain("Consultar la agenda de un día cercano");
  });
});
