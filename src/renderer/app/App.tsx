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
import { bindRecordingCancellation } from "../features/voice/recording-cancellation";
import { createSpeechEndDetector, type SpeechEndDetector } from "../features/voice/speech-end-detector";
import { createVoiceTranscriptSubmission } from "../features/voice/voice-transcript-submission";
import type { VoiceMimeType } from "../../shared/voice-contracts";
import { type DraftActionState } from "../features/assistant/interpretation-result";
import { UtilityPanel } from "../features/settings/utility-panel";
import { useThemePreference } from "../features/settings/use-theme-preference";
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
  const { theme, toggleTheme } = useThemePreference();
  const [viewState, setViewState] = useState<ViewState>({ kind: "LOADING" });
  const [destination, setDestination] = useState<Destination>("ARES");
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [interpretation, setInterpretation] = useState<AssistantInterpretation>();
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [draftStates, setDraftStates] = useState<Record<number, DraftActionState>>({});
  const [spokenResponse, setSpokenResponse] = useState<import("../../shared/speech-contracts").SpokenResponse>();
  const [automaticSpeech, setAutomaticSpeech] = useState(true);
  useEffect(() => { setSpokenResponse(undefined); }, [destination]);
  const [selectedCatalogApplication, setSelectedCatalogApplication] = useState<RegisterableCatalogApplication>("GOOGLE_CHROME");
  const [isRegisteringCatalogApplication, setIsRegisteringCatalogApplication] = useState(false);
  const [catalogRegistrationMessage, setCatalogRegistrationMessage] = useState<string>();
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [isRegisteringCustomApplication, setIsRegisteringCustomApplication] = useState(false);
  const [customRegistrationMessage, setCustomRegistrationMessage] = useState<string>();
  const [voiceMessage, setVoiceMessage] = useState<string>();
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const voiceRecorder = useRef<ManualVoiceRecorder | undefined>(undefined);
  const speechEndDetector = useRef<SpeechEndDetector | undefined>(undefined);
  const voiceStateReference = useRef(voiceState);
  const voiceStartInFlight = useRef(false);
  const voiceGeneration = useRef(0);
  const voiceUploadGeneration = useRef(-1);
  const voiceSubmission = useRef(createVoiceTranscriptSubmission());
  const interpretationInFlight = useRef(false);
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

  const cancelRecording = (): void => {
    if (voiceStateReference.current === "IDLE" && !voiceStartInFlight.current) return;
    voiceGeneration.current++;
    speechEndDetector.current?.dispose();
    speechEndDetector.current = undefined;
    voiceRecorder.current?.cancel();
    if (voiceStateReference.current === "PROCESSING") {
      voiceStateReference.current = "IDLE";
      setVoiceState("IDLE");
      setVoiceMessage("Grabación cancelada");
    }
  };
  useEffect(() => {
    const cleanup = bindRecordingCancellation(document, window, () => document.hidden, cancelRecording);
    return () => { voiceGeneration.current++; speechEndDetector.current?.dispose(); voiceRecorder.current?.dispose(); cleanup(); };
  }, []);
  useEffect(() => { if (destination !== "ARES") cancelRecording(); }, [destination]);
  useEffect(() => { voiceStateReference.current = voiceState; }, [voiceState]);

  const transcribeAudio = async (audio: Blob, mimeType: VoiceMimeType, durationMs: number, generation: number): Promise<void> => {
    if (generation !== voiceGeneration.current || generation <= voiceUploadGeneration.current) return;
    voiceUploadGeneration.current = generation;
    try {
      const bytes = await audio.arrayBuffer();
      if (generation !== voiceGeneration.current) return;
      const result = await window.ares.voice.transcribe({ audio: bytes, mimeType, durationMs });
      if (generation !== voiceGeneration.current) return;
      if (!result.ok) return setVoiceMessage(result.error.userMessage);
      setVoiceMessage("Procesando instrucción…");
      await voiceSubmission.current.submit({
        generation, text: result.data.text, isCurrent: () => generation === voiceGeneration.current,
        showTranscript: setInstruction,
        interpret: (text) => submitInstruction(text, true, () => generation === voiceGeneration.current),
        propose: (index, draft) => requestProposal(index, draft, () => generation === voiceGeneration.current)
      });
      if (generation === voiceGeneration.current) setVoiceMessage("Instrucción procesada. Revisa el resultado y confirma si se requiere.");
    } catch {
      if (generation === voiceGeneration.current) setVoiceMessage("La transcripción no está disponible en este momento.");
    } finally {
      if (generation === voiceGeneration.current) { voiceStateReference.current = "IDLE"; setVoiceState("IDLE"); }
    }
  };

  const startRecording = async (fromGlobalShortcut = false): Promise<void> => {
    setSpokenResponse(undefined);
    if (voiceStateReference.current !== "IDLE" || voiceStartInFlight.current || interpretationInFlight.current) return;
    voiceStartInFlight.current = true;
    const generation = ++voiceGeneration.current;
    setDestination("ARES");
    setVoiceMessage(fromGlobalShortcut ? "Ares está grabando." : undefined);
    const browserMedia = navigator.mediaDevices;
    if (!browserMedia || typeof MediaRecorder === "undefined") {
      setVoiceMessage("Este navegador no puede grabar audio compatible.");
      voiceStartInFlight.current = false;
      return;
    }
    let levelAnalysisAvailable = true;
    let maximumWithoutSpeech = false;
    const detector = createSpeechEndDetector({
      onSpeechEnded: () => {
        if (generation === voiceGeneration.current) voiceRecorder.current?.stop();
      }
    });
    speechEndDetector.current = detector;
    voiceRecorder.current = createManualVoiceRecorder({
      getUserMedia: () => browserMedia.getUserMedia({ audio: true }),
      createRecorder: (stream, mimeType) => new MediaRecorder(stream as MediaStream, { mimeType }),
      isMimeTypeSupported: MediaRecorder.isTypeSupported,
      createBlob: (parts, options) => new Blob(parts, options),
      setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: (timer) => clearTimeout(timer),
      maximumDurationMs: 10_000,
      onMaximumDuration: () => {
        if (!levelAnalysisAvailable || detector.hasDetectedSpeech()) {
          voiceRecorder.current?.stop();
          return;
        }
        maximumWithoutSpeech = true;
        voiceRecorder.current?.cancel();
      },
      onStream: (stream) => {
        if (!detector.start(stream as MediaStream)) {
          levelAnalysisAvailable = false;
          setVoiceMessage("No se pudo detectar el fin de la voz; la grabación terminará al alcanzar el límite.");
        }
      },
      onRecording: () => { voiceStateReference.current = "RECORDING"; setVoiceState("RECORDING"); },
      onProcessing: () => { detector.dispose(); voiceStateReference.current = "PROCESSING"; setVoiceState("PROCESSING"); setVoiceMessage("Procesando…"); },
      onUnavailable: (message, reason) => {
        voiceStartInFlight.current = false;
        setVoiceState("IDLE");
        setVoiceMessage(fromGlobalShortcut && reason === "USER_GESTURE_REQUIRED" ? "Para iniciar la grabación, usa el botón visible." : message);
      },
      isUserActivationActive: () => navigator.userActivation?.isActive ?? false,
      onCancelled: () => { detector.dispose(); voiceStartInFlight.current = false; voiceStateReference.current = "IDLE"; setVoiceState("IDLE"); setVoiceMessage(maximumWithoutSpeech ? "No se entendió la instrucción." : "Grabación cancelada"); },
      onAudio: (recording, recordingMimeType, durationMs) => { detector.dispose(); void transcribeAudio(recording, recordingMimeType, durationMs, generation); }
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
      startRecording: () => { void startRecording(true); }, stopRecording: cancelRecording
    });
    return window.ares.voice.onGlobalShortcut(controller.activate);
  }, []);

  const submitInstruction = async (instruction: string, automaticProposal = false, isCurrent = () => true): Promise<AssistantInterpretation | undefined> => {
    setSpokenResponse(undefined);
    if (interpretationInFlight.current || !isCurrent()) return;
    interpretationInFlight.current = true;
    setIsInterpreting(true); setInterpretation(undefined); setDraftStates({});
    try {
      const result = getInterpretationMessage(await window.ares.assistant.interpret({ text: instruction }));
      if (!isCurrent()) return;
      if (automaticProposal && result.state === "READY") setDraftStates(Object.fromEntries(result.drafts.map((_draft, index) => [index, { busy: true, resolved: false }])));
      setInterpretation(result);
      setSpokenResponse(result.spokenResponse);
      return result;
    } catch {
      if (isCurrent()) setInterpretation({ state: "UNAVAILABLE", summary: "La interpretación no está disponible en este momento.", drafts: [], clarifications: [] });
    } finally {
      interpretationInFlight.current = false;
      setIsInterpreting(false);
    }
  };

  const interpret = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (voiceStateReference.current !== "IDLE") return;
    await submitInstruction(instruction);
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

  const requestProposal = async (index: number, draft: ActionSubmission, isCurrent = () => true): Promise<void> => {
    if (!isCurrent()) return;
    setSpokenResponse(undefined);
    updateDraftState(index, { busy: true, resolved: false });
    try {
      const result = await window.ares.actions.propose(draft);
      if (!isCurrent()) return;
      if (!result.ok) {
        updateDraftState(index, { busy: false, resolved: true, userMessage: result.error.userMessage });
        setSpokenResponse(result.error.spokenResponse);
        return;
      }
      if (isAwaitingConfirmation(result.data)) {
        updateDraftState(index, { busy: false, resolved: true, confirmation: result.data, userMessage: result.data.confirmation.summary });
        setSpokenResponse(result.data.spokenResponse);
        return;
      }
      updateDraftState(index, { busy: false, resolved: true, userMessage: result.data.userSummary, spokenResponse: result.data.spokenResponse });
      setSpokenResponse(result.data.spokenResponse);
    } catch {
      if (isCurrent()) updateDraftState(index, { busy: false, resolved: true, userMessage: "No se pudo proponer la acción." });
    }
  };

  const propose = async (index: number, draft: ActionSubmission): Promise<void> => {
    const state = draftStates[index];
    if (state?.busy || state?.resolved) return;
    await requestProposal(index, draft);
  };

  const resolveConfirmation = async (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL"): Promise<void> => {
    const state = draftStates[index];
    if (!state || state.busy || !state.confirmation) return;
    setSpokenResponse(undefined);
    updateDraftState(index, { ...state, busy: true });
    try {
      const result = decision === "CONFIRM" ? await window.ares.actions.confirm(confirmation.confirmationId) : await window.ares.actions.cancel(confirmation.confirmationId);
      updateDraftState(index, { busy: false, resolved: true, userMessage: result.ok ? result.data.userSummary : result.error.userMessage, spokenResponse: result.ok ? result.data.spokenResponse : result.error.spokenResponse });
      setSpokenResponse(result.ok ? result.data.spokenResponse : result.error.spokenResponse);
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
      onToggleTheme={toggleTheme}
      onVoiceShortcutChange={setSelectedVoiceShortcut}
      onVoiceShortcutEnabledChange={setVoiceShortcutEnabled}
      selectedCatalogApplication={selectedCatalogApplication}
      selectedVoiceShortcut={selectedVoiceShortcut}
      theme={theme}
      voicePreferencesMessage={voicePreferencesMessage}
      voiceShortcutEnabled={voiceShortcutEnabled}
      voiceShortcutStatus={voiceShortcutStatus}
    />}

    {destination === "ARES" ? <AresView
      spokenResponse={spokenResponse}
      automaticSpeech={automaticSpeech}
      onAutomaticSpeechChange={setAutomaticSpeech}
      draftStates={draftStates}
      instruction={instruction}
      interpretation={interpretation}
      isInterpreting={isInterpreting}
      onCancelRecording={cancelRecording}
      onInstructionChange={setInstruction}
      onInterpret={(event) => void interpret(event)}
      onPropose={(index, draft) => void propose(index, draft)}
      onResolveConfirmation={(index, confirmation, decision) => void resolveConfirmation(index, confirmation, decision)}
      onStartRecording={() => void startRecording()}
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
