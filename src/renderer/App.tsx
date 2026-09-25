import { type FormEvent, useEffect, useState } from "react";

import type {
  AssistantInterpretation,
  AssistantOperationResult
} from "../shared/assistant-contracts";
import type {
  ActionLifecycleResult,
  ActionOutcome,
  ActionSubmission,
  AwaitingActionConfirmation
} from "../shared/action-contracts";
import type { SystemCapabilities, SystemStatusData } from "../shared/contracts";
import {
  REGISTERABLE_CATALOG_APPLICATIONS,
  type CatalogApplicationRegistrationData,
  type CustomApplicationRegistrationData,
  type RegisterableCatalogApplication
} from "../shared/application-contracts";

type ViewState =
  | { kind: "LOADING" }
  | { kind: "SUCCESS"; status: SystemStatusData; capabilities: SystemCapabilities }
  | { kind: "ERROR"; userMessage: string };

type DraftActionState = {
  busy: boolean;
  resolved: boolean;
  userMessage?: string;
  confirmation?: AwaitingActionConfirmation;
};

const capabilityLabels: Record<keyof SystemCapabilities, string> = {
  database: "Base de datos",
  dashboard: "Inicio",
  planner: "Planificador",
  files: "Archivos",
  applications: "Aplicaciones",
  assistant: "Asistente",
  voice: "Voz",
  notifications: "Notificaciones"
};

const actionLabels: Record<ActionSubmission["action"], string> = {
  CREATE_TASK: "Crear tarea",
  UPDATE_TASK: "Actualizar tarea",
  COMPLETE_TASK: "Completar tarea",
  CREATE_EVENT: "Crear evento",
  UPDATE_EVENT: "Actualizar evento",
  CREATE_REMINDER: "Crear recordatorio",
  GET_TODAY_SCHEDULE: "Consultar agenda de hoy",
  GET_WEEK_SCHEDULE: "Consultar agenda semanal",
  OPEN_APPLICATION: "Abrir aplicación registrada",
  OPEN_WEB_PAGE: "Abrir página web autorizada",
  SEARCH_FILES: "Buscar archivos",
  CREATE_FOLDER: "Crear carpeta",
  RENAME_FILE: "Renombrar archivo",
  RENAME_FOLDER: "Renombrar carpeta",
  MOVE_FILE: "Mover archivo",
  ORGANIZE_FILES: "Organizar archivos"
};

const catalogApplicationLabels: Record<RegisterableCatalogApplication, string> = {
  GOOGLE_CHROME: "Google Chrome",
  VISUAL_STUDIO_CODE: "Visual Studio Code",
  VISUAL_STUDIO: "Visual Studio",
  SPOTIFY: "Spotify"
};

const isAwaitingConfirmation = (
  result: ActionLifecycleResult
): result is AwaitingActionConfirmation => "lifecycleState" in result;

const getInterpretationMessage = (
  result: AssistantOperationResult<AssistantInterpretation>
): AssistantInterpretation =>
  result.ok
    ? result.data
    : {
        state: "UNAVAILABLE",
        summary: result.error.userMessage,
        drafts: [],
        clarifications: []
      };

export const App = () => {
  const [viewState, setViewState] = useState<ViewState>({ kind: "LOADING" });
  const [instruction, setInstruction] = useState("");
  const [interpretation, setInterpretation] = useState<AssistantInterpretation>();
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [draftStates, setDraftStates] = useState<Record<number, DraftActionState>>({});
  const [selectedCatalogApplication, setSelectedCatalogApplication] =
    useState<RegisterableCatalogApplication>("GOOGLE_CHROME");
  const [isRegisteringCatalogApplication, setIsRegisteringCatalogApplication] = useState(false);
  const [catalogRegistrationMessage, setCatalogRegistrationMessage] = useState<string>();
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [isRegisteringCustomApplication, setIsRegisteringCustomApplication] = useState(false);
  const [customRegistrationMessage, setCustomRegistrationMessage] = useState<string>();

  useEffect(() => {
    const loadTechnicalStatus = async (): Promise<void> => {
      const [statusResult, capabilitiesResult] = await Promise.all([
        window.ares.system.getStatus(),
        window.ares.system.getCapabilities()
      ]);
      if (!statusResult.ok) {
        setViewState({ kind: "ERROR", userMessage: statusResult.error.userMessage });
        return;
      }
      if (!capabilitiesResult.ok) {
        setViewState({ kind: "ERROR", userMessage: capabilitiesResult.error.userMessage });
        return;
      }
      setViewState({ kind: "SUCCESS", status: statusResult.data, capabilities: capabilitiesResult.data });
    };

    void loadTechnicalStatus().catch(() => {
      setViewState({ kind: "ERROR", userMessage: "No se pudo consultar el estado técnico de Ares." });
    });
  }, []);

  const interpret = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isInterpreting) return;
    setIsInterpreting(true);
    setInterpretation(undefined);
    setDraftStates({});
    try {
      const result = await window.ares.assistant.interpret({ text: instruction });
      setInterpretation(getInterpretationMessage(result));
    } catch {
      setInterpretation({
        state: "UNAVAILABLE",
        summary: "La interpretación no está disponible en este momento.",
        drafts: [],
        clarifications: []
      });
    } finally {
      setIsInterpreting(false);
    }
  };

  const updateDraftState = (index: number, state: DraftActionState): void => {
    setDraftStates((current) => ({ ...current, [index]: state }));
  };

  const registerCatalogApplication = async (): Promise<void> => {
    if (isRegisteringCatalogApplication) return;
    setIsRegisteringCatalogApplication(true);
    setCatalogRegistrationMessage(undefined);
    try {
      const result = await window.ares.applications.registerCatalogApplication({
        application: selectedCatalogApplication
      });
      if (!result.ok) {
        setCatalogRegistrationMessage(result.error.userMessage);
        return;
      }
      const data: CatalogApplicationRegistrationData = result.data;
      const applicationLabel = catalogApplicationLabels[data.application];
      setCatalogRegistrationMessage(
        data.status === "CANCELLED"
          ? `La selección de ${applicationLabel} se canceló.`
          : data.status === "ALREADY_REGISTERED"
            ? `${applicationLabel} ya está registrado.`
            : `${applicationLabel} se registró correctamente.`
      );
    } catch {
      setCatalogRegistrationMessage("No se pudo registrar la aplicación.");
    } finally {
      setIsRegisteringCatalogApplication(false);
    }
  };

  const registerCustomApplication = async (): Promise<void> => {
    if (isRegisteringCustomApplication) return;
    setIsRegisteringCustomApplication(true);
    setCustomRegistrationMessage(undefined);
    try {
      const result = await window.ares.applications.registerCustomApplication({
        displayName: customDisplayName
      });
      if (!result.ok) {
        setCustomRegistrationMessage(result.error.userMessage);
        return;
      }
      const data: CustomApplicationRegistrationData = result.data;
      setCustomRegistrationMessage(
        data.status === "CANCELLED"
          ? "El registro de la aplicación se canceló."
          : data.status === "ALREADY_REGISTERED"
            ? "La aplicación ya está registrada."
            : "La aplicación se registró correctamente."
      );
    } catch {
      setCustomRegistrationMessage("No se pudo registrar la aplicación.");
    } finally {
      setIsRegisteringCustomApplication(false);
    }
  };

  const propose = async (index: number, draft: ActionSubmission): Promise<void> => {
    const state = draftStates[index];
    if (state?.busy || state?.resolved) return;
    updateDraftState(index, { busy: true, resolved: false });
    try {
      const result = await window.ares.actions.propose(draft);
      if (!result.ok) {
        updateDraftState(index, { busy: false, resolved: true, userMessage: result.error.userMessage });
        return;
      }
      if (isAwaitingConfirmation(result.data)) {
        updateDraftState(index, {
          busy: false,
          resolved: true,
          confirmation: result.data,
          userMessage: result.data.confirmation.summary
        });
        return;
      }
      updateDraftState(index, { busy: false, resolved: true, userMessage: result.data.userSummary });
    } catch {
      updateDraftState(index, { busy: false, resolved: true, userMessage: "No se pudo proponer la acción." });
    }
  };

  const resolveConfirmation = async (
    index: number,
    confirmation: AwaitingActionConfirmation,
    decision: "CONFIRM" | "CANCEL"
  ): Promise<void> => {
    const state = draftStates[index];
    if (!state || state.busy || !state.confirmation) return;
    updateDraftState(index, { ...state, busy: true });
    try {
      const result =
        decision === "CONFIRM"
          ? await window.ares.actions.confirm(confirmation.confirmationId)
          : await window.ares.actions.cancel(confirmation.confirmationId);
      updateDraftState(index, {
        busy: false,
        resolved: true,
        userMessage: result.ok ? result.data.userSummary : result.error.userMessage
      });
    } catch {
      updateDraftState(index, {
        busy: false,
        resolved: true,
        userMessage: decision === "CONFIRM" ? "No se pudo confirmar la acción." : "No se pudo cancelar la acción."
      });
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-white p-8 text-slate-900">
      <section className="w-full max-w-2xl space-y-4 text-center">
        <h1 className="text-3xl font-semibold">Ares</h1>
        <p className="text-base">Base técnica en funcionamiento</p>
        {viewState.kind === "LOADING" && <p className="text-sm text-slate-600">Consultando estado técnico...</p>}
        {viewState.kind === "ERROR" && <p className="text-sm text-slate-600">{viewState.userMessage}</p>}
        {viewState.kind === "SUCCESS" && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>La comunicación segura está en funcionamiento.</p>
            <p>Versión {viewState.status.applicationVersion}</p>
            <ul className="list-none p-0">
              {(Object.keys(viewState.capabilities) as Array<keyof SystemCapabilities>).map((capability) => (
                <li key={capability}>
                  {capabilityLabels[capability]}: {viewState.capabilities[capability] ? "disponible" : "no disponible todavía"}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section aria-label="Registro técnico de aplicaciones" className="space-y-2 border-t pt-4 text-left">
          <h2 className="text-lg font-medium">Registro técnico de aplicaciones</h2>
          <p className="text-sm text-slate-600">Selecciona el ejecutable instalado de una aplicación aprobada.</p>
          <label className="block text-sm" htmlFor="catalog-application">Aplicación</label>
          <select
            className="border p-1 text-sm"
            disabled={isRegisteringCatalogApplication}
            id="catalog-application"
            onChange={(event) => setSelectedCatalogApplication(event.target.value as RegisterableCatalogApplication)}
            value={selectedCatalogApplication}
          >
            {REGISTERABLE_CATALOG_APPLICATIONS.map((application) => (
              <option key={application} value={application}>{catalogApplicationLabels[application]}</option>
            ))}
          </select>
          <button
            className="border px-3 py-1 text-sm"
            disabled={isRegisteringCatalogApplication}
            onClick={() => void registerCatalogApplication()}
            type="button"
          >
            {isRegisteringCatalogApplication ? "Registrando..." : "Registrar aplicación"}
          </button>
          {catalogRegistrationMessage && <p aria-live="polite" className="text-sm">{catalogRegistrationMessage}</p>}
        </section>

        <section aria-label="Registro técnico de aplicación personalizada" className="space-y-2 border-t pt-4 text-left">
          <h2 className="text-lg font-medium">Registrar aplicación personalizada</h2>
          <p className="text-sm text-slate-600">Indica un nombre y selecciona su archivo ejecutable.</p>
          <label className="block text-sm" htmlFor="custom-application-name">Nombre de la aplicación</label>
          <input
            className="border p-1 text-sm"
            disabled={isRegisteringCustomApplication}
            id="custom-application-name"
            onChange={(event) => setCustomDisplayName(event.target.value)}
            type="text"
            value={customDisplayName}
          />
          <button
            className="border px-3 py-1 text-sm"
            disabled={isRegisteringCustomApplication}
            onClick={() => void registerCustomApplication()}
            type="button"
          >
            {isRegisteringCustomApplication ? "Registrando..." : "Registrar aplicación personalizada"}
          </button>
          {customRegistrationMessage && <p aria-live="polite" className="text-sm">{customRegistrationMessage}</p>}
        </section>

        <section aria-label="Interpretación técnica" className="space-y-3 border-t pt-4 text-left">
          <h2 className="text-lg font-medium">Interpretación técnica</h2>
          <form className="space-y-2" onSubmit={(event) => void interpret(event)}>
            <label className="block text-sm" htmlFor="assistant-instruction">Instrucción</label>
            <textarea
              id="assistant-instruction"
              className="min-h-24 w-full border p-2 text-sm"
              disabled={isInterpreting}
              onChange={(event) => setInstruction(event.target.value)}
              value={instruction}
            />
            <button className="border px-3 py-1 text-sm" disabled={isInterpreting} type="submit">
              {isInterpreting ? "Interpretando..." : "Interpretar"}
            </button>
          </form>

          {interpretation && (
            <div aria-live="polite" className="space-y-2 text-sm">
              <p>{interpretation.summary}</p>
              {interpretation.clarifications.map((item, index) => <p key={`${item.question}-${index}`}>{item.question}</p>)}
              {interpretation.drafts.map((draft, index) => {
                const state = draftStates[index];
                return (
                  <article className="space-y-2 border p-2" key={`${draft.action}-${index}`}>
                    <p>{actionLabels[draft.action]}</p>
                    <button
                      className="border px-2 py-1"
                      disabled={state?.busy || state?.resolved}
                      onClick={() => void propose(index, draft)}
                      type="button"
                    >
                      {state?.busy ? "Procesando..." : "Proponer acción"}
                    </button>
                    {state?.userMessage && <p>{state.userMessage}</p>}
                    {state?.confirmation && !state.busy && (
                      <div className="space-x-2">
                        <button className="border px-2 py-1" onClick={() => void resolveConfirmation(index, state.confirmation!, "CONFIRM")} type="button">Confirmar</button>
                        <button className="border px-2 py-1" onClick={() => void resolveConfirmation(index, state.confirmation!, "CANCEL")} type="button">Cancelar</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
};
