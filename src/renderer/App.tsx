import { type FormEvent, useEffect, useMemo, useState } from "react";

import type {
  AssistantInterpretation,
  AssistantOperationResult
} from "../shared/assistant-contracts";
import type {
  ActionLifecycleResult,
  ActionSubmission,
  AwaitingActionConfirmation
} from "../shared/action-contracts";
import type { ChromeRegistrationData } from "../shared/application-contracts";
import type { EventRecord, PlannerListData, TodayScheduleData } from "../shared/planner-contracts";
import { ConnectedPointsVisual } from "./connected-points-visual";
import { formatLocalClock } from "./local-clock";
import {
  formatEventTime,
  getPlannerPanelState,
  getUpcomingEvents,
  summarizeToday,
  type PlannerPanelState
} from "./ares-planner-summary";

type DraftActionState = {
  busy: boolean;
  resolved: boolean;
  userMessage?: string;
  confirmation?: AwaitingActionConfirmation;
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

const isAwaitingConfirmation = (
  result: ActionLifecycleResult
): result is AwaitingActionConfirmation => "lifecycleState" in result;

const getInterpretationMessage = (
  result: AssistantOperationResult<AssistantInterpretation>
): AssistantInterpretation => result.ok
  ? result.data
  : { state: "UNAVAILABLE", summary: result.error.userMessage, drafts: [], clarifications: [] };

export const App = () => {
  const [instruction, setInstruction] = useState("");
  const [interpretation, setInterpretation] = useState<AssistantInterpretation>();
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [draftStates, setDraftStates] = useState<Record<number, DraftActionState>>({});
  const [isRegisteringChrome, setIsRegisteringChrome] = useState(false);
  const [chromeRegistrationMessage, setChromeRegistrationMessage] = useState<string>();
  const [todayState, setTodayState] = useState<PlannerPanelState<TodayScheduleData>>({ kind: "LOADING" });
  const [eventsState, setEventsState] = useState<PlannerPanelState<PlannerListData<EventRecord>>>({ kind: "LOADING" });
  const [localTime, setLocalTime] = useState(() => formatLocalClock(new Date()));

  useEffect(() => {
    const updateClock = (): void => setLocalTime(formatLocalClock(new Date()));
    const intervalId = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let active = true;
    const loadPlannerSummary = async (): Promise<void> => {
      const now = new Date();
      const [todayResult, eventsResult] = await Promise.all([
        window.ares.planner.schedule.getToday({ includeCompletedTasks: true }),
        window.ares.planner.events.list({ startAt: now.toISOString() })
      ]);
      if (!active) return;
      setTodayState(getPlannerPanelState(todayResult, "No se pudo cargar el resumen de hoy."));
      setEventsState(getPlannerPanelState(eventsResult, "No se pudieron cargar los eventos próximos."));
    };
    void loadPlannerSummary().catch(() => {
      if (!active) return;
      setTodayState({ kind: "ERROR", userMessage: "No se pudo cargar el resumen de hoy." });
      setEventsState({ kind: "ERROR", userMessage: "No se pudieron cargar los eventos próximos." });
    });
    return () => { active = false; };
  }, []);

  const todaySummary = useMemo(
    () => todayState.kind === "READY" ? summarizeToday(todayState.data, new Date()) : undefined,
    [todayState]
  );
  const upcomingEvents = useMemo(
    () => eventsState.kind === "READY" ? getUpcomingEvents(eventsState.data.items, new Date()) : [],
    [eventsState]
  );

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

  const registerChrome = async (): Promise<void> => {
    if (isRegisteringChrome) return;
    setIsRegisteringChrome(true);
    setChromeRegistrationMessage(undefined);
    try {
      const result = await window.ares.applications.registerChrome();
      if (!result.ok) {
        setChromeRegistrationMessage(result.error.userMessage);
        return;
      }
      const data: ChromeRegistrationData = result.data;
      setChromeRegistrationMessage(
        data.status === "CANCELLED"
          ? "La selección de Google Chrome se canceló."
          : data.status === "ALREADY_REGISTERED"
            ? "Google Chrome ya está registrado."
            : "Google Chrome se registró correctamente."
      );
    } catch {
      setChromeRegistrationMessage("No se pudo registrar Google Chrome.");
    } finally {
      setIsRegisteringChrome(false);
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
      const result = decision === "CONFIRM"
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
    <main className="ares-shell">
      <time aria-label="Hora local" className="ares-clock">{localTime}</time>
      <section className="ares-workspace" aria-label="Ares">
        <aside className="planner-rail planner-rail--today" aria-labelledby="today-summary-heading">
          <p className="planner-rail__eyebrow">Resumen de hoy</p>
          <h2 id="today-summary-heading">Tu enfoque</h2>
          <p className="planner-rail__description">Ares es tu centro personal de productividad para organizar lo importante.</p>
          {todayState.kind === "LOADING" && <p className="planner-rail__state">Cargando tu resumen de hoy…</p>}
          {todayState.kind === "ERROR" && <p className="planner-rail__state">{todayState.userMessage}</p>}
          {todaySummary && (
            <dl className="planner-rail__metrics">
              <div><dt>Tareas pendientes</dt><dd>{todaySummary.pendingTasks}</dd></div>
              <div><dt>Tareas completadas</dt><dd>{todaySummary.completedTasks}</dd></div>
              <div><dt>Eventos por venir</dt><dd>{todaySummary.upcomingEvents}</dd></div>
            </dl>
          )}
          {todaySummary && todaySummary.pendingTasks === 0 && todaySummary.completedTasks === 0 && todaySummary.upcomingEvents === 0 && (
            <p className="planner-rail__state">No tienes actividades para hoy.</p>
          )}
        </aside>

        <section className="ares-command" aria-labelledby="ares-heading">
          <div className="ares-command__identity">
            <ConnectedPointsVisual />
            <p className="ares-command__eyebrow">Centro personal</p>
            <h1 id="ares-heading">Ares</h1>
          </div>

          <section aria-label="Instrucción para Ares" className="command-entry">
            <form onSubmit={(event) => void interpret(event)}>
              <label htmlFor="assistant-instruction">¿En qué quieres avanzar?</label>
              <textarea id="assistant-instruction" disabled={isInterpreting} onChange={(event) => setInstruction(event.target.value)} value={instruction} />
              <button disabled={isInterpreting} type="submit">{isInterpreting ? "Interpretando…" : "Interpretar"}</button>
            </form>

            {interpretation && (
              <div aria-live="polite" className="interpretation-result">
                <p>{interpretation.summary}</p>
                {interpretation.clarifications.map((item, index) => <p key={`${item.question}-${index}`}>{item.question}</p>)}
                {interpretation.drafts.map((draft, index) => {
                  const state = draftStates[index];
                  return (
                    <article key={`${draft.action}-${index}`}>
                      <p>{actionLabels[draft.action]}</p>
                      <button disabled={state?.busy || state?.resolved} onClick={() => void propose(index, draft)} type="button">{state?.busy ? "Procesando…" : "Proponer acción"}</button>
                      {state?.userMessage && <p>{state.userMessage}</p>}
                      {state?.confirmation && !state.busy && (
                        <div className="interpretation-result__actions">
                          <button onClick={() => void resolveConfirmation(index, state.confirmation!, "CONFIRM")} type="button">Confirmar</button>
                          <button onClick={() => void resolveConfirmation(index, state.confirmation!, "CANCEL")} type="button">Cancelar</button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <details className="application-utility">
            <summary>Aplicaciones</summary>
            <p>Registra Google Chrome para usarlo desde Ares.</p>
            <button disabled={isRegisteringChrome} onClick={() => void registerChrome()} type="button">{isRegisteringChrome ? "Registrando…" : "Registrar Google Chrome"}</button>
            {chromeRegistrationMessage && <p aria-live="polite">{chromeRegistrationMessage}</p>}
          </details>
        </section>

        <aside className="planner-rail planner-rail--events" aria-labelledby="upcoming-events-heading">
          <p className="planner-rail__eyebrow">Próximos eventos</p>
          <h2 id="upcoming-events-heading">En tu agenda</h2>
          {eventsState.kind === "LOADING" && <p className="planner-rail__state">Cargando próximos eventos…</p>}
          {eventsState.kind === "ERROR" && <p className="planner-rail__state">{eventsState.userMessage}</p>}
          {eventsState.kind === "READY" && upcomingEvents.length === 0 && <p className="planner-rail__state">No tienes eventos próximos.</p>}
          {eventsState.kind === "READY" && upcomingEvents.length > 0 && (
            <ol className="planner-rail__events">
              {upcomingEvents.map((event) => <li key={event.id}><time dateTime={event.startAt}>{formatEventTime(event.startAt)}</time><span>{event.title}</span></li>)}
            </ol>
          )}
        </aside>
      </section>
    </main>
  );
};
