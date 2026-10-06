import { describe, expect, it, vi } from "vitest";

import {
  createAssistantInterpretationService,
  type AssistantInterpreter
} from "../src/main/assistant/assistant-composition";
import type { ApplicationService } from "../src/main/applications/application-service";
import type { AssistantContextService } from "../src/main/assistant/assistant-context-service";
import type { ApplicationRecord } from "../src/shared/application-contracts";
import type { PlannerService } from "../src/main/planner/planner-service";

const readyResult = {
  ok: true as const,
  data: {
    state: "READY" as const,
    summary: "Interpretación lista.",
    drafts: [],
    clarifications: []
  }
};

const chromeRecord: ApplicationRecord = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Google Chrome",
  platform: "WINDOWS",
  isFavorite: false,
  isEnabled: true,
  lastLaunchedAt: null,
  aliases: [{ id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", applicationId: "550e8400-e29b-41d4-a716-446655440000", alias: "chrome", createdAt: "2026-09-20T00:00:00.000Z" }],
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z"
};

const catalogRecords: ApplicationRecord[] = [
  chromeRecord,
  {
    ...chromeRecord,
    id: "550e8400-e29b-41d4-a716-446655440001",
    name: "Visual Studio Code",
    aliases: [{ ...chromeRecord.aliases[0], applicationId: "550e8400-e29b-41d4-a716-446655440001", alias: "vscode" }]
  },
  {
    ...chromeRecord,
    id: "550e8400-e29b-41d4-a716-446655440002",
    name: "Visual Studio",
    aliases: [{ ...chromeRecord.aliases[0], applicationId: "550e8400-e29b-41d4-a716-446655440002", alias: "visualstudio" }]
  },
  {
    ...chromeRecord,
    id: "550e8400-e29b-41d4-a716-446655440003",
    name: "Spotify",
    aliases: [{ ...chromeRecord.aliases[0], applicationId: "550e8400-e29b-41d4-a716-446655440003", alias: "spotify" }]
  }
];

const customRecord: ApplicationRecord = {
  ...chromeRecord,
  id: "550e8400-e29b-41d4-a716-446655440004",
  name: "Example App",
  aliases: [{ ...chromeRecord.aliases[0], applicationId: "550e8400-e29b-41d4-a716-446655440004", alias: "example-app" }]
};

const applicationServiceFor = (items: ApplicationRecord[] = []) => ({
  listApplications: vi.fn(async () => ({ ok: true as const, data: { items, total: items.length } }))
}) as unknown as Pick<ApplicationService, "listApplications">;

const weeklyScheduleServiceFor = (items: unknown[] = []) => ({
  listWeeklySchedules: vi.fn(async () => ({ ok: true as const, data: { items, total: items.length } }))
}) as unknown as Pick<PlannerService, "listWeeklySchedules">;

describe("assistant interpretation composition", () => {
  it("maps the public text request to the internal instruction contract", async () => {
    const interpret = vi.fn(async () => readyResult);
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor()
    });

    await expect(service.interpret({ text: "Crear una tarea" })).resolves.toEqual(readyResult);
    expect(interpret).toHaveBeenCalledWith(
      { instruction: "Crear una tarea" },
      { knownApplicationAliases: [] },
      undefined,
      expect.any(Function)
    );
  });

  it("rejects malformed public input before reaching the interpreter", async () => {
    const interpret = vi.fn(async () => readyResult);
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor()
    });

    const result = await service.interpret({ text: "x", context: "forbidden" });
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("permits one in-flight interpretation and rejects concurrent requests without a second provider call", async () => {
    let resolveFirst: ((value: typeof readyResult) => void) | undefined;
    const interpret = vi.fn(
      () => new Promise<typeof readyResult>((resolve) => { resolveFirst = resolve; })
    );
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor()
    });

    const first = service.interpret({ text: "Primera" });
    const second = await service.interpret({ text: "Segunda" });
    expect(second).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_BUSY" } });
    await vi.waitFor(() => expect(interpret).toHaveBeenCalledTimes(1));

    resolveFirst?.(readyResult);
    await expect(first).resolves.toEqual(readyResult);
  });

  it("maps an unexpected interpreter failure without leaking technical details", async () => {
    const secret = "provider-key-or-database-detail";
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret: vi.fn(async () => { throw new Error(secret); }) } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor()
    });

    const result = await service.interpret({ text: "Solicitud" });
    expect(result).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("supplies only normalized enabled aliases before the provider request and validates them again for application drafts", async () => {
    const disabledRecord = { ...chromeRecord, id: "550e8400-e29b-41d4-a716-446655440005", isEnabled: false, aliases: [{ ...chromeRecord.aliases[0], applicationId: "550e8400-e29b-41d4-a716-446655440005", alias: "disabled" }] };
    const interpret = vi.fn(async (_input, reference, _context, resolveTrustedReference) => {
      expect(reference).toEqual({ knownApplicationAliases: ["chrome", "vscode", "visualstudio", "spotify", "example-app"] });
      const resolved = await resolveTrustedReference(["OPEN_APPLICATION"]);
      expect(resolved).toEqual({
        reference: {
          knownApplicationAliases: ["chrome", "vscode", "visualstudio", "spotify", "example-app"]
        },
        currentContext: undefined
      });
      return readyResult;
    });
    const listApplications = vi.fn(async () => ({ ok: true as const, data: { items: [...catalogRecords, customRecord, disabledRecord], total: 6 } }));
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => ({ listApplications } as unknown as Pick<ApplicationService, "listApplications">)
    });

    await expect(service.interpret({ text: "Abre Google Chrome" })).resolves.toEqual(readyResult);
    expect(listApplications).toHaveBeenCalledWith({ enabled: true, limit: 100 });
    expect(listApplications).toHaveBeenCalledTimes(2);
    const providerReference = interpret.mock.calls[0]?.[1];
    expect(JSON.stringify(providerReference)).not.toContain("executablePath");
    expect(JSON.stringify(providerReference)).not.toContain("Google Chrome");
    expect(JSON.stringify(providerReference)).not.toContain("disabled");
    expect(JSON.stringify(providerReference)).not.toContain(chromeRecord.id);
  });

  it("keeps a mocked chrome draft on the existing ready path", async () => {
    const chromeDraft = {
      ok: true as const,
      data: {
        state: "READY" as const,
        summary: "Preparé los borradores solicitados.",
        drafts: [{ action: "OPEN_APPLICATION" as const, input: { alias: "chrome" } }],
        clarifications: []
      }
    };
    const interpret = vi.fn(async (_input, reference) => {
      expect(reference.knownApplicationAliases).toContain("chrome");
      return chromeDraft;
    });
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor([chromeRecord])
    });

    await expect(service.interpret({ text: "Abre Chrome" })).resolves.toEqual(chromeDraft);
  });

  it("keeps a conversational result available when the alias lookup fails", async () => {
    const interpret = vi.fn(async () => ({
      ok: true as const,
      data: {
        state: "CONVERSATIONAL" as const,
        summary: "Hola, Juli. Estoy listo para ayudarte.",
        drafts: [],
        clarifications: []
      }
    }));
    const listApplications = vi.fn(async () => ({
      ok: false as const,
      error: { code: "APPLICATION_DATABASE_UNAVAILABLE", userMessage: "private" }
    }));
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => ({ listApplications } as unknown as Pick<ApplicationService, "listApplications">)
    });

    await expect(service.interpret({ text: "Hola Ares, ¿qué tal están tus servidores hoy?" })).resolves.toEqual({
      ok: true,
      data: {
        state: "CONVERSATIONAL",
        summary: "Hola, Juli. Estoy listo para ayudarte.",
        drafts: [],
        clarifications: []
      }
    });
    expect(listApplications).toHaveBeenCalledWith({ enabled: true, limit: 100 });
    expect(interpret).toHaveBeenCalledOnce();
  });

  it("supplies a bounded weekly schedule-title context without identifiers, routine details, or configuration values", async () => {
    const privateSchedule = {
      id: "550e8400-e29b-41d4-a716-446655440099",
      title: "  Universidad  ",
      description: "private description",
      color: "#123456",
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z"
    };
    const interpret = vi.fn(async (_input, reference) => {
      expect(reference).toEqual({ knownApplicationAliases: [], knownWeeklyScheduleTitles: ["Universidad"] });
      return readyResult;
    });
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor(),
      getPlannerService: () => weeklyScheduleServiceFor([privateSchedule])
    });

    await expect(service.interpret({ text: "¿Qué tengo en mi horario de Universidad?" })).resolves.toEqual(readyResult);
    const providerReference = interpret.mock.calls[0]?.[1];
    expect(JSON.stringify(providerReference)).not.toContain(privateSchedule.id);
    expect(JSON.stringify(providerReference)).not.toContain("private description");
    expect(JSON.stringify(providerReference)).not.toContain("#123456");
  });

  it("supplies only bounded active habit titles and fixed icon keys to interpretation", async () => {
    const privateHabit = {
      id: "550e8400-e29b-41d4-a716-446655440088", title: "  Leer  ", description: "private description", categoryId: "550e8400-e29b-41d4-a716-446655440089",
      icon: "BOOK" as const, frequency: "DAILY" as const, targetCount: 1, active: true,
      createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z"
    };
    const interpret = vi.fn(async (_input, providerReference) => {
      expect(providerReference).toMatchObject({ knownHabitTitles: ["Leer"], allowedHabitIcons: expect.arrayContaining(["BOOK", "DUMBBELL"]) });
      return readyResult;
    });
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor(),
      getHabitService: () => ({ list: vi.fn(async () => ({ ok: true as const, data: { items: [privateHabit], total: 1 } })) } as never)
    });

    await expect(service.interpret({ text: "Muéstrame el progreso de Leer" })).resolves.toEqual(readyResult);
    const serialized = JSON.stringify(interpret.mock.calls[0]?.[1]);
    expect(serialized).not.toContain(privateHabit.id);
    expect(serialized).not.toContain("private description");
    expect(serialized).not.toContain(privateHabit.categoryId);
  });

  it("continues a conversational interpretation when weekly-title lookup fails", async () => {
    const interpret = vi.fn(async () => ({
      ok: true as const,
      data: { state: "CONVERSATIONAL" as const, summary: "Hola, Juli.", drafts: [], clarifications: [] }
    }));
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor(),
      getPlannerService: () => ({
        listWeeklySchedules: vi.fn(async () => ({ ok: false as const, error: { code: "PLANNER_DATABASE_UNAVAILABLE", userMessage: "private" } }))
      } as unknown as Pick<PlannerService, "listWeeklySchedules">)
    });

    await expect(service.interpret({ text: "Hola" })).resolves.toMatchObject({ ok: true, data: { state: "CONVERSATIONAL" } });
    expect(interpret).toHaveBeenCalledWith({ instruction: "Hola" }, { knownApplicationAliases: [], knownWeeklyScheduleTitles: [] }, undefined, expect.any(Function));
  });

  it("passes only the validated context token, kind, and label to the provider boundary", async () => {
    const interpret = vi.fn(async () => readyResult);
    const context = {
      providerContext: { token: "$CURRENT_CONTEXT" as const, kind: "FOLDER" as const, label: "inbox" },
      selection: { section: "FILES" as const, kind: "FOLDER" as const, reference: { rootId: "DOCUMENTS" as const, relativePath: "inbox" } }
    };
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => applicationServiceFor(),
      getContextService: () => ({
        getCachedProviderContext: vi.fn(() => context.providerContext),
        getValidated: vi.fn(async () => context)
      } as unknown as AssistantContextService)
    });
    await service.interpret({ text: "Organiza esta carpeta" }, 42);
    expect(interpret).toHaveBeenCalledWith(
      { instruction: "Organiza esta carpeta" },
      { knownApplicationAliases: [], currentContext: context.providerContext },
      undefined,
      expect.any(Function)
    );
  });
});
