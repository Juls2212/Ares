import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: {}, dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() } }));

import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import { ENABLED_ASSISTANT_CAPABILITIES, getEnabledAssistantCapability } from "../src/main/actions/capability-registry";
import type { ActionExecutor } from "../src/main/actions/action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { createCustomApplicationRegistrationService } from "../src/main/applications/custom-application-registration-service";
import type { ActionOutcome, ExecutableActionProposal } from "../src/shared/action-contracts";

const pickedPath = "C:\\Tools\\Figma\\Figma.exe";
const REQUEST = "REQUEST_CUSTOM_APPLICATION_REGISTRATION" as const;

const createService = (overrides: Record<string, unknown> = {}) => {
  const registerApplication = vi.fn(async (_input: unknown) => ({ ok: true as const, data: { record: {} as never } }));
  const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [pickedPath] }));
  let clock = 1_000;
  let counter = 0;
  const service = createCustomApplicationRegistrationService({
    applicationService: {
      listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [], total: 0 } })),
      registerApplication
    } as never,
    showOpenDialog,
    showConfirmation: vi.fn(async () => ({ response: 1 })),
    realpath: async (path: string) => path,
    stat: async () => ({ isFile: () => true }),
    now: () => clock,
    generateIdentifier: () => `selection-${++counter}`,
    logError: vi.fn(),
    ...overrides
  } as never);
  return { service, registerApplication, showOpenDialog, advance: (ms: number) => { clock += ms; } };
};

describe("capability and policy for voice-triggered custom registration", () => {
  it("is enabled in the APPLICATIONS domain with standard confirmation", () => {
    expect(getEnabledAssistantCapability(REQUEST)).toMatchObject({
      domain: "APPLICATIONS",
      approval: "CONFIRMATION_REQUIRED",
      executor: "APPLICATION",
      enabled: true
    });
    expect(ENABLED_ASSISTANT_CAPABILITIES.filter((entry) => entry.action === REQUEST)).toHaveLength(1);
    expect(getActionPolicy(REQUEST)).toMatchObject({
      approval: "CONFIRMATION_REQUIRED",
      riskLevel: 2,
      availability: "IMPLEMENTED",
      confirmation: { required: true }
    });
  });
});

describe("custom application selection service", () => {
  it("returns a friendly name and an opaque reference, never a path", async () => {
    const { service, showOpenDialog } = createService();
    const result = await service.prepareSelection({});
    expect(result).toEqual({ ok: true, data: { displayName: "Figma", selectionId: "selection-1" } });
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/Tools|\.exe|C:\\/);
  });

  it("uses the spoken friendly name when one was given", async () => {
    const { service } = createService();
    await expect(service.prepareSelection({ displayName: "Diseño" })).resolves.toMatchObject({
      ok: true,
      data: { displayName: "Diseño" }
    });
  });

  it("rejects any caller-supplied path or extra field before opening the picker", async () => {
    const { service, showOpenDialog } = createService();
    for (const input of [{ executablePath: "C:\\evil.exe" }, { displayName: "App", path: "C:\\evil.exe" }, "C:\\evil.exe", null, []]) {
      await expect(service.prepareSelection(input)).resolves.toMatchObject({ ok: false });
    }
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it("reports a cancelled picker with the cancellation code", async () => {
    const { service, registerApplication } = createService({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
    await expect(service.prepareSelection({})).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CUSTOM_REGISTRATION_CANCELLED", userMessage: "Se canceló el registro de la aplicación." }
    });
    expect(registerApplication).not.toHaveBeenCalled();
  });

  it("validates the chosen file with the existing executable rules", async () => {
    const { service } = createService({ showOpenDialog: async () => ({ canceled: false, filePaths: ["C:\\Tools\\script.cmd"] }) });
    await expect(service.prepareSelection({})).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CUSTOM_SELECTION_INVALID" }
    });
  });

  it("persists only after commit, as a single-use legacy executable target", async () => {
    const { service, registerApplication } = createService();
    const prepared = await service.prepareSelection({});
    if (!prepared.ok) throw new Error("Expected a prepared selection.");
    expect(registerApplication).not.toHaveBeenCalled();

    const committed = await service.commitSelection({ selectionId: prepared.data.selectionId });
    expect(committed).toEqual({ ok: true, data: { applicationName: "Figma" } });
    expect(registerApplication).toHaveBeenCalledWith({
      name: "Figma",
      executablePath: pickedPath,
      aliases: ["figma"],
      platform: "WINDOWS",
      isEnabled: true
    });
    expect(JSON.stringify(committed)).not.toMatch(/Tools|\.exe/);
    await expect(service.commitSelection({ selectionId: prepared.data.selectionId })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CUSTOM_CONFIRMATION_UNAVAILABLE" }
    });
  });

  it("rejects unknown, malformed, and expired selection references", async () => {
    const { service, registerApplication, advance } = createService();
    await expect(service.commitSelection({ selectionId: "unknown" })).resolves.toMatchObject({ ok: false });
    await expect(service.commitSelection({ selectionId: "x", path: pickedPath })).resolves.toMatchObject({ ok: false });
    await expect(service.commitSelection({})).resolves.toMatchObject({ ok: false });
    const prepared = await service.prepareSelection({});
    if (!prepared.ok) throw new Error("Expected a prepared selection.");
    advance(6 * 60 * 1000);
    await expect(service.commitSelection({ selectionId: prepared.data.selectionId })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CUSTOM_CONFIRMATION_UNAVAILABLE" }
    });
    expect(registerApplication).not.toHaveBeenCalled();
  });

  it("re-validates the file at commit time", async () => {
    let exists = true;
    const { service, registerApplication } = createService({
      realpath: async (path: string) => { if (!exists) throw new Error("gone"); return path; }
    });
    const prepared = await service.prepareSelection({});
    if (!prepared.ok) throw new Error("Expected a prepared selection.");
    exists = false;
    await expect(service.commitSelection({ selectionId: prepared.data.selectionId })).resolves.toMatchObject({ ok: false });
    expect(registerApplication).not.toHaveBeenCalled();
  });
});

describe("voice-triggered custom registration flow", () => {
  const identifiers = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ];
  const createFlow = (prepared: unknown) => {
    const execute = vi.fn(async (proposal: ExecutableActionProposal): Promise<ActionOutcome> => ({
      actionId: proposal.actionId,
      action: proposal.action,
      riskLevel: 2,
      status: "SUCCEEDED",
      data: { applicationName: "Figma" },
      userSummary: "Listo, registré Figma."
    }));
    const executor: ActionExecutor = {
      execute,
      prepareCustomRegistration: vi.fn(async () => prepared as never)
    };
    const recordTerminal = vi.fn(async () => ({ ok: true as const, data: {} as never }));
    const historyService = { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService;
    const generateIdentifier = vi.fn();
    identifiers.forEach((identifier) => generateIdentifier.mockReturnValueOnce(identifier));
    const orchestrator = createActionOrchestrator({
      executor,
      historyService,
      generateIdentifier,
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      logError: vi.fn()
    });
    return { orchestrator, execute, executor, recordTerminal };
  };

  it("shows a real Main-issued confirmation token before anything is registered", async () => {
    const { orchestrator, execute } = createFlow({ ok: true, data: { displayName: "Figma", selectionId: "selection-1" } });

    const proposed = await orchestrator.propose({ action: REQUEST, input: {} });

    expect(proposed).toMatchObject({
      ok: true,
      data: {
        lifecycleState: "AWAITING_CONFIRMATION",
        action: REQUEST,
        riskLevel: 2,
        confirmationId: identifiers[1],
        confirmation: { required: true, summary: "Se registrará «Figma» como una aplicación elegida por ti.", scopeSummary: "Aplicación elegida" }
      }
    });
    expect(JSON.stringify(proposed)).not.toMatch(/selection-1|\.exe|C:\\|Tools/);
    expect(execute).not.toHaveBeenCalled();
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected confirmation.");

    const confirmed = await orchestrator.confirm(proposed.data.confirmationId);
    expect(confirmed).toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: REQUEST, input: { displayName: "Figma", selectionId: "selection-1" } }),
      expect.anything()
    );
  });

  it("never accepts a path, selection reference, or extra field from the caller", async () => {
    const { orchestrator, executor } = createFlow({ ok: true, data: { displayName: "Figma", selectionId: "selection-1" } });
    for (const input of [
      { executablePath: "C:\\evil.exe" },
      { displayName: "Figma", selectionId: "forged" },
      { displayName: 7 },
      "C:\\evil.exe"
    ]) {
      await expect(orchestrator.propose({ action: REQUEST, input })).resolves.toMatchObject({
        ok: false,
        error: { code: "ACTION_PROPOSAL_INVALID" }
      });
    }
    expect(executor.prepareCustomRegistration).not.toHaveBeenCalled();
  });

  it("records a cancelled picker as a cancelled outcome and opens no confirmation", async () => {
    const { orchestrator, execute, recordTerminal } = createFlow({
      ok: false,
      error: { code: "APPLICATION_CUSTOM_REGISTRATION_CANCELLED", userMessage: "Se canceló el registro de la aplicación." }
    });
    const proposed = await orchestrator.propose({ action: REQUEST, input: {} });
    expect(proposed).toMatchObject({
      ok: true,
      data: { status: "CANCELLED", userSummary: "Se canceló el registro de la aplicación." }
    });
    expect("lifecycleState" in (proposed.ok ? proposed.data : {})).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(recordTerminal).toHaveBeenCalledOnce();
  });

  it("reports an invalid selection as a validation failure without a confirmation", async () => {
    const { orchestrator } = createFlow({
      ok: false,
      error: { code: "APPLICATION_CUSTOM_SELECTION_INVALID", userMessage: "Debes seleccionar un archivo ejecutable válido." }
    });
    await expect(orchestrator.propose({ action: REQUEST, input: {} })).resolves.toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "APPLICATION_CUSTOM_SELECTION_INVALID" }
    });
  });

  it("commits through the application executor with a safe terminal outcome", async () => {
    const commitSelection = vi.fn(async () => ({ ok: true as const, data: { applicationName: "Figma" } }));
    const executor = createApplicationActionExecutor({
      customRegistrationService: { prepareSelection: vi.fn(), commitSelection, registerCustomApplication: vi.fn() },
      logError: vi.fn()
    });
    const outcome = await executor.execute(
      { actionId: identifiers[0], action: REQUEST, input: { displayName: "Figma", selectionId: "selection-1" } },
      getActionPolicy(REQUEST)
    );
    expect(commitSelection).toHaveBeenCalledWith({ selectionId: "selection-1" });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", data: { applicationName: "Figma" }, userSummary: "Listo, registré Figma." });
    expect(JSON.stringify(outcome)).not.toMatch(/selection-1|\.exe|C:\\/);
  });

  it("maps a failed commit to a controlled outcome", async () => {
    const executor = createApplicationActionExecutor({
      customRegistrationService: {
        prepareSelection: vi.fn(),
        commitSelection: vi.fn(async () => ({
          ok: false as const,
          error: { code: "APPLICATION_CUSTOM_CONFIRMATION_UNAVAILABLE", userMessage: "No se pudo confirmar el registro de la aplicación." }
        })),
        registerCustomApplication: vi.fn()
      },
      logError: vi.fn()
    });
    await expect(executor.execute(
      { actionId: identifiers[0], action: REQUEST, input: { displayName: "Figma", selectionId: "stale" } },
      getActionPolicy(REQUEST)
    )).resolves.toMatchObject({ status: "VALIDATION_FAILED", userSummary: "No se pudo confirmar el registro de la aplicación." });
  });
});

describe("interpreter draft for custom registration", () => {
  const interpreterFor = (draftInput: unknown) => createAssistantInterpreter({
    getConfiguration: () => ({ apiKey: "", model: "" }),
    createProvider: () => ({
      interpret: async () => JSON.stringify({
        state: "READY",
        summary: "Preparé las acciones solicitadas.",
        responseText: "",
        clarifications: [],
        drafts: [{
          action: REQUEST,
          input: draftInput === null ? null : JSON.stringify(draftInput),
          weeklyRoutine: null,
          habitAction: null,
          approvedWeb: null,
          catalogApplication: null
        }]
      })
    }),
    now: () => new Date("2026-09-20T15:00:00.000Z"),
    timeZone: () => "America/Bogota"
  });

  it("accepts an empty input and an optional friendly name", async () => {
    await expect(interpreterFor({}).interpret({ instruction: "Registra una aplicación" })).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: REQUEST, input: {} }] }
    });
    await expect(interpreterFor({ displayName: "Figma" }).interpret({ instruction: "Agrega la app Figma" })).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: REQUEST, input: { displayName: "Figma" } }] }
    });
  });

  it("rejects a model-supplied path or extra field", async () => {
    for (const draftInput of [{ executablePath: "C:\\evil.exe" }, { displayName: "App", path: "C:\\x.exe" }]) {
      const result = await interpreterFor(draftInput).interpret({ instruction: "Registra una aplicación" });
      expect(result).toMatchObject({ ok: true, data: { drafts: [] } });
      expect(result.ok && result.data.state).not.toBe("READY");
      expect(JSON.stringify(result)).not.toContain("evil");
    }
  });

  it("asks for a valid name instead of passing an unsafe one", async () => {
    const result = await interpreterFor({ displayName: "C:\\evil.exe; powershell" }).interpret({ instruction: "Registra una aplicación" });
    expect(result.ok && result.data.state).toBe("NEEDS_CLARIFICATION");
    expect(result.ok && result.data.drafts).toEqual([]);
  });
});
