import { describe, expect, it, vi } from "vitest";

import {
  createAssistantInterpretationService,
  type AssistantInterpreter
} from "../src/main/assistant/assistant-composition";
import type { ApplicationService } from "../src/main/applications/application-service";
import type { ApplicationRecord } from "../src/shared/application-contracts";

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
      { knownApplicationAliases: [], knownApplications: [] }
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
    expect(interpret).toHaveBeenCalledTimes(1);

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

  it("supplies only enabled public display-name and alias references to the Main interpreter", async () => {
    const interpret = vi.fn(async () => readyResult);
    const listApplications = vi.fn(async () => ({ ok: true as const, data: { items: [...catalogRecords, customRecord], total: 5 } }));
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => ({ listApplications } as unknown as Pick<ApplicationService, "listApplications">)
    });

    await expect(service.interpret({ text: "Abre Google Chrome" })).resolves.toEqual(readyResult);
    expect(listApplications).toHaveBeenCalledWith({ enabled: true, limit: 100 });
    expect(interpret).toHaveBeenCalledWith(
      { instruction: "Abre Google Chrome" },
      {
        knownApplicationAliases: ["chrome", "vscode", "visualstudio", "spotify", "example-app"],
        knownApplications: [
          { displayName: "Google Chrome", alias: "chrome" },
          { displayName: "Visual Studio Code", alias: "vscode" },
          { displayName: "Visual Studio", alias: "visualstudio" },
          { displayName: "Spotify", alias: "spotify" },
          { displayName: "Example App", alias: "example-app" }
        ]
      }
    );
    expect(JSON.stringify(interpret.mock.calls)).not.toContain("executablePath");
  });

  it("does not invoke the interpreter when trusted application lookup fails", async () => {
    const interpret = vi.fn(async () => readyResult);
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter),
      getApplicationService: () => ({
        listApplications: vi.fn(async () => ({ ok: false as const, error: { code: "APPLICATION_DATABASE_UNAVAILABLE", userMessage: "private" } }))
      } as unknown as Pick<ApplicationService, "listApplications">)
    });

    const result = await service.interpret({ text: "Abre Google Chrome" });
    expect(result).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(interpret).not.toHaveBeenCalled();
  });
});
