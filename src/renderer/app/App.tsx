import { type FormEvent, useEffect, useRef, useState } from "react";

import type { AssistantInterpretation, AssistantOperationResult } from "../../shared/assistant-contracts";
import type {
  ActionLifecycleResult,
  ActionSubmission,
  AwaitingActionConfirmation
} from "../../shared/action-contracts";
import {
  type CatalogApplicationRegistrationData,
  type CustomApplicationRegistrationData,
  type RegisterableCatalogApplication
} from "../../shared/application-contracts";
import type { SystemCapabilities, SystemStatusData } from "../../shared/contracts";
import {
  VOICE_SHORTCUTS,
  type VoiceShortcut,
  type VoiceShortcutEffectiveStatus
} from "../../shared/settings-contracts";
import {
  catalogApplicationLabels,
  orbStateFor,
  type Destination,
  type VoiceState,
  voiceLabelFor
} from "./app-state";
import { createGlobalVoiceShortcutController } from "../features/voice/global-voice-shortcut-controller";
import { createManualVoiceRecorder, type ManualVoiceRecorder } from "../features/voice/manual-voice-recorder";
import { type DraftActionState } from "../features/assistant/interpretation-result";
import { UtilityPanel } from "../features/settings/utility-panel";
import { AresView } from "../views/ares-view";
import { CalendarView } from "../views/calendar-view";

type ViewState =
  | { kind: "LOADING" }
  | { kind: "SUCCESS"; status: SystemStatusData; capabilities: SystemCapabilities }
  | { kind: "ERROR"; userMessage: string };

const isAwaitingConfirmation = (result: ActionLifecycleResult): result is AwaitingActionConfirmation =>
  "lifecycleState" in result;

const getInterpretationMessage = (result: AssistantOperationResult<AssistantInterpretation>): AssistantInterpretation =>
  result.ok ? result.data : { state: "UNAVAILABLE", summary: result.error.userMessage, drafts: [], clarifications: [] };

export const App = () => {
  const [viewState, setViewState] = useState<ViewState>({ kind: "LOADING" });
  const [destination, setDestination] = useState<Destination>("ARES");
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [interpretation, setInterpretation] = useState<AssistantInterpretation>();
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [draftStates, setDraftStates] = useState<Record<number, DraftActionState>>({});
  const [selectedCatalogApplication, setSelectedCatalogApplication] = useState<RegisterableCatalogApplication>("GOOGLE_CHROME");
  const [isRegisteringCatalogApplication, setIsRegisteringCatalogApplication] = useState(false);
  const [catalogRegistrationMessage, setCatalogRegistrationMessage] = useState<string>();
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [isRegisteringCustomApplication, setIsRegisteringCustomApplication] = useState(false);
  const [customRegistrationMessage, setCustomRegistrationMessage] = useState<string>();
  const [voiceMessage, setVoiceMessage] = useState<string>();
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const voiceRecorder = useRef<ManualVoiceRecorder | undefined>(undefined);
  const voiceStateReference = useRef(voiceState);
  const voiceStartInFlight = useRef(false);
  const [voiceShortcutEnabled, setVoiceShortcutEnabled] = useState(true);
  const [selectedVoiceShortcut, setSelectedVoiceShortcut] = useState<VoiceShortcut>(VOICE_SHORTCUTS[0]);
  const [voiceShortcutStatus, setVoiceShortcutStatus] = useState<VoiceShortcutEffectiveStatus>();
  const [voicePreferencesMessage, setVoicePreferencesMessage] = useState<string>();
  const [isUpdatingVoicePreferences, setIsUpdatingVoicePreferences] = useState(false);

  useEffect(() => {
    const loadTechnicalStatus = async (): Promise<void> => {
      const [statusResult, capabilitiesResult] = await Promise.all([window.ares.system.getStatus(), window.ares.system.getCapabilities()]);
      if (!statusResult.ok) return setViewState({ kind: "ERROR", userMessage: statusResult.error.userMessage });
      if (!capabilitiesResult.ok) return setViewState({ kind: "ERROR", userMessage: capabilitiesResult.error.userMessage });
      setViewState({ kind: "SUCCESS", status: statusResult.data, capabilities: capabilitiesResult.data });
    };
    void loadTechnicalStatus().catch(() => setViewState({ kind: "ERROR", userMessage: "No se pudo consultar el estado técnico de Ares." }));
  }, []);

  useEffect(() => {
    const loadVoicePreferences = async (): Promise<void> => {
      try {
        const result = await window.ares.settings.voice.get();
        if (!result.ok) return setVoicePreferencesMessage(result.error.userMessage);
        setVoiceShortcutEnabled(result.data.preferences.enabled);
        setSelectedVoiceShortcut(result.data.preferences.shortcut);
        setVoiceShortcutStatus(result.data.effectiveStatus);
      } catch {
        setVoicePreferencesMessage("La configuración de voz no está disponible.");
      }
    };
    void loadVoicePreferences();
  }, []);

  useEffect(() => () => voiceRecorder.current?.dispose(), []);
  useEffect(() => { voiceStateReference.current = voiceState; }, [voiceState]);

  const transcribeAudio = async (audio: Blob, mimeType: string): Promise<void> => {
    try {
      const result = await window.ares.voice.transcribe({ audio: await audio.arrayBuffer(), mimeType: mimeType as "audio/webm" });
      if (!result.ok) return setVoiceMessage(result.error.userMessage);
      setInstruction(result.data.text);
      setVoiceMessage("Transcripción lista. Revisa el texto y selecciona Interpretar.");
    } catch {
      setVoiceMessage("La transcripción no está disponible en este momento.");
    } finally {
      setVoiceState("IDLE");
    }
  };

  const startRecording = async (fromGlobalShortcut = false): Promise<void> => {
    if (voiceState !== "IDLE" || voiceStartInFlight.current) return;
    voiceStartInFlight.current = true;
    setDestination("ARES");
    setVoiceMessage(fromGlobalShortcut ? "Ares está grabando." : undefined);
    const browserMedia = navigator.mediaDevices;
    if (!browserMedia || typeof MediaRecorder === "undefined") {
      setVoiceMessage("Este navegador no puede grabar audio compatible.");
      voiceStartInFlight.current = false;
      return;
    }
    voiceRecorder.current = createManualVoiceRecorder({
      getUserMedia: () => browserMedia.getUserMedia({ audio: true }),
      createRecorder: (stream, mimeType) => new MediaRecorder(stream as MediaStream, { mimeType }),
      isMimeTypeSupported: MediaRecorder.isTypeSupported,
      createBlob: (parts, options) => new Blob(parts, options),
      setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: (timer) => clearTimeout(timer),
      onRecording: () => setVoiceState("RECORDING"), onProcessing: () => setVoiceState("PROCESSING"),
      onUnavailable: (message, reason) => {
        voiceStartInFlight.current = false;
        setVoiceState("IDLE");
        setVoiceMessage(fromGlobalShortcut && reason === "USER_GESTURE_REQUIRED" ? "Para iniciar la grabación, usa el botón visible." : message);
      },
      isUserActivationActive: () => navigator.userActivation?.isActive ?? false,
      onCancelled: () => { voiceStartInFlight.current = false; setVoiceState("IDLE"); setVoiceMessage("La grabación se canceló."); },
      onAudio: (recording, recordingMimeType) => { void transcribeAudio(recording, recordingMimeType); }
    });
    await voiceRecorder.current.start();
    voiceStartInFlight.current = false;
  };

  const updateVoicePreferences = async (): Promise<void> => {
    if (isUpdatingVoicePreferences) return;
    setIsUpdatingVoicePreferences(true);
    setVoicePreferencesMessage(undefined);
    try {
      const result = await window.ares.settings.voice.update({ enabled: voiceShortcutEnabled, shortcut: selectedVoiceShortcut });
      if (!result.ok) return setVoicePreferencesMessage(result.error.userMessage);
      setVoiceShortcutEnabled(result.data.preferences.enabled);
      setSelectedVoiceShortcut(result.data.preferences.shortcut);
      setVoiceShortcutStatus(result.data.effectiveStatus);
      setVoicePreferencesMessage("La configuración de voz se actualizó.");
    } catch {
      setVoicePreferencesMessage("La configuración de voz no está disponible.");
    } finally {
      setIsUpdatingVoicePreferences(false);
    }
  };

  useEffect(() => {
    if (!window.ares?.voice?.onGlobalShortcut) return;

    const controller = createGlobalVoiceShortcutController({
      getState: () => voiceStateReference.current,
      startRecording: () => { void startRecording(true); }, stopRecording: () => voiceRecorder.current?.stop()
    });
    return window.ares.voice.onGlobalShortcut(controller.activate);
  }, []);

  const interpret = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isInterpreting) return;
    setIsInterpreting(true); setInterpretation(undefined); setDraftStates({});
    try {
      setInterpretation(getInterpretationMessage(await window.ares.assistant.interpret({ text: instruction })));
    } catch {
      setInterpretation({ state: "UNAVAILABLE", summary: "La interpretación no está disponible en este momento.", drafts: [], clarifications: [] });
    } finally {
      setIsInterpreting(false);
    }
  };

  const updateDraftState = (index: number, state: DraftActionState): void => setDraftStates((current) => ({ ...current, [index]: state }));

  const registerCatalogApplication = async (): Promise<void> => {
    if (isRegisteringCatalogApplication) return;
    setIsRegisteringCatalogApplication(true); setCatalogRegistrationMessage(undefined);
    try {
      const result = await window.ares.applications.registerCatalogApplication({ application: selectedCatalogApplication });
      if (!result.ok) return setCatalogRegistrationMessage(result.error.userMessage);
      const data: CatalogApplicationRegistrationData = result.data;
      const label = catalogApplicationLabels[data.application];
      setCatalogRegistrationMessage(data.status === "CANCELLED" ? `La selección de ${label} se canceló.` : data.status === "ALREADY_REGISTERED" ? `${label} ya está registrado.` : `${label} se registró correctamente.`);
    } catch {
      setCatalogRegistrationMessage("No se pudo registrar la aplicación.");
    } finally {
      setIsRegisteringCatalogApplication(false);
    }
  };

  const registerCustomApplication = async (): Promise<void> => {
    if (isRegisteringCustomApplication) return;
    setIsRegisteringCustomApplication(true); setCustomRegistrationMessage(undefined);
    try {
      const result = await window.ares.applications.registerCustomApplication({ displayName: customDisplayName });
      if (!result.ok) return setCustomRegistrationMessage(result.error.userMessage);
      const data: CustomApplicationRegistrationData = result.data;
      setCustomRegistrationMessage(data.status === "CANCELLED" ? "El registro de la aplicación se canceló." : data.status === "ALREADY_REGISTERED" ? "La aplicación ya está registrada." : "La aplicación se registró correctamente.");
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
      if (!result.ok) return updateDraftState(index, { busy: false, resolved: true, userMessage: result.error.userMessage });
      if (isAwaitingConfirmation(result.data)) return updateDraftState(index, { busy: false, resolved: true, confirmation: result.data, userMessage: result.data.confirmation.summary });
      updateDraftState(index, { busy: false, resolved: true, userMessage: result.data.userSummary });
    } catch {
      updateDraftState(index, { busy: false, resolved: true, userMessage: "No se pudo proponer la acción." });
    }
  };

  const resolveConfirmation = async (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL"): Promise<void> => {
    const state = draftStates[index];
    if (!state || state.busy || !state.confirmation) return;
    updateDraftState(index, { ...state, busy: true });
    try {
      const result = decision === "CONFIRM" ? await window.ares.actions.confirm(confirmation.confirmationId) : await window.ares.actions.cancel(confirmation.confirmationId);
      updateDraftState(index, { busy: false, resolved: true, userMessage: result.ok ? result.data.userSummary : result.error.userMessage });
    } catch {
      updateDraftState(index, { busy: false, resolved: true, userMessage: decision === "CONFIRM" ? "No se pudo confirmar la acción." : "No se pudo cancelar la acción." });
    }
  };

  const orbState = orbStateFor(voiceState, isInterpreting);
  const voiceLabel = voiceLabelFor(voiceState, isInterpreting);

  return <main className="ares-shell">
    <header className="ares-header">
      <button aria-label="Ares" className="wordmark" onClick={() => setDestination("ARES")} type="button">ARES</button>
      <nav aria-label="Navegación principal" className="primary-navigation">
        <button aria-current={destination === "ARES" ? "page" : undefined} className={destination === "ARES" ? "is-active" : undefined} onClick={() => setDestination("ARES")} type="button">Ares</button>
        <button aria-current={destination === "CALENDAR" ? "page" : undefined} className={destination === "CALENDAR" ? "is-active" : undefined} onClick={() => setDestination("CALENDAR")} type="button">Calendario</button>
      </nav>
      <button aria-controls="utility-panel" aria-expanded={utilityOpen} aria-label="Controles técnicos" className="utility-toggle" onClick={() => setUtilityOpen((open) => !open)} type="button">⚙</button>
    </header>

    {utilityOpen && <UtilityPanel
      catalogRegistrationMessage={catalogRegistrationMessage}
      customDisplayName={customDisplayName}
      customRegistrationMessage={customRegistrationMessage}
      isRegisteringCatalogApplication={isRegisteringCatalogApplication}
      isRegisteringCustomApplication={isRegisteringCustomApplication}
      isUpdatingVoicePreferences={isUpdatingVoicePreferences}
      onCatalogApplicationChange={setSelectedCatalogApplication}
      onCustomDisplayNameChange={setCustomDisplayName}
      onRegisterCatalogApplication={() => void registerCatalogApplication()}
      onRegisterCustomApplication={() => void registerCustomApplication()}
      onSaveVoicePreferences={() => void updateVoicePreferences()}
      onVoiceShortcutChange={setSelectedVoiceShortcut}
      onVoiceShortcutEnabledChange={setVoiceShortcutEnabled}
      selectedCatalogApplication={selectedCatalogApplication}
      selectedVoiceShortcut={selectedVoiceShortcut}
      voicePreferencesMessage={voicePreferencesMessage}
      voiceShortcutEnabled={voiceShortcutEnabled}
      voiceShortcutStatus={voiceShortcutStatus}
    />}

    {destination === "ARES" ? <AresView
      draftStates={draftStates}
      instruction={instruction}
      interpretation={interpretation}
      isInterpreting={isInterpreting}
      onCancelRecording={() => voiceRecorder.current?.cancel()}
      onInstructionChange={setInstruction}
      onInterpret={(event) => void interpret(event)}
      onPropose={(index, draft) => void propose(index, draft)}
      onResolveConfirmation={(index, confirmation, decision) => void resolveConfirmation(index, confirmation, decision)}
      onStartRecording={() => void startRecording()}
      onStopRecording={() => voiceRecorder.current?.stop()}
      orbState={orbState}
      technicalMessage={viewState.kind === "ERROR" ? viewState.userMessage : undefined}
      technicalState={viewState.kind}
      voiceLabel={voiceLabel}
      voiceMessage={voiceMessage}
      voiceShortcutStatus={voiceShortcutStatus}
      voiceState={voiceState}
    /> : <CalendarView />}
  </main>;
};
