import { useEffect, useRef, useState } from "react";

import type { AssistantInterpretation, AssistantOperationResult } from "../../shared/assistant-contracts";
import type {
  ActionLifecycleResult,
  ActionSubmission,
  AwaitingActionConfirmation
} from "../../shared/action-contracts";
import type { SystemCapabilities, SystemStatusData } from "../../shared/contracts";
import { formatShortcutForDisplay, type VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import {
  orbStateFor,
  type VoiceState,
  voiceLabelFor
} from "./app-state";
import { createGlobalVoiceShortcutController } from "../features/voice/global-voice-shortcut-controller";
import { createManualVoiceRecorder, type ManualVoiceRecorder } from "../features/voice/manual-voice-recorder";
import { bindRecordingCancellation } from "../features/voice/recording-cancellation";
import { beginCurrentTurn, markCurrentTurn } from "../../shared/turn-timing";
import { SPEECH_ACTIVITY_THRESHOLD, createSpeechEndDetector, type SpeechEndDetector } from "../features/voice/speech-end-detector";
import {
  VOICE_CAPTURE_FAILURES,
  createVoiceAttempt,
  failureCodeForTranscription,
  normalizeMicrophoneAccess,
  peakLevelOf,
  type MicrophoneAccessStatus,
  type VoiceAttempt
} from "../../shared/voice-diagnostics";
import { orbAmplitudeSource } from "../features/voice/orb-amplitude";
import { LIVE_RECORDING_LIMIT_MS } from "../features/voice/recording-limits";
import { createVoiceTranscriptSubmission } from "../features/voice/voice-transcript-submission";
import { VOICE_ERROR_CODES, type VoiceMimeType } from "../../shared/voice-contracts";
import { type DraftActionState } from "../features/assistant/interpretation-result";
import type { ContactFormRequest } from "../../shared/messaging-contracts";
import { ContactFormDialog, type ContactFormValues } from "../features/messaging/contact-form-dialog";
import { AresView } from "../views/ares-view";
import { ThemeToggle } from "../features/theme/theme-toggle";
import { LOCAL_MODE_HINT, VOICE_NEEDS_KEY_MESSAGE, isCommandShortcut } from "../features/assistant/command-input";
import { useThemeName } from "../orb/orb-canvas";

type ViewState =
  | { kind: "LOADING" }
  | { kind: "SUCCESS"; status: SystemStatusData; capabilities: SystemCapabilities }
  | { kind: "ERROR"; userMessage: string };

const isAwaitingConfirmation = (result: ActionLifecycleResult): result is AwaitingActionConfirmation =>
  "lifecycleState" in result;

const getInterpretationMessage = (result: AssistantOperationResult<AssistantInterpretation>): AssistantInterpretation =>
  result.ok
    ? result.data
    : {
        state: "UNAVAILABLE",
        summary: result.error.userMessage,
        drafts: [],
        clarifications: [],
        spokenResponse: result.error.spokenResponse
      };

/** The shortcut hint is shown once per session, however many times the view mounts. */
let shortcutHintShown = false;
const SHORTCUT_HINT_DURATION_MS = 8_000;

export const App = () => {
  const [viewState, setViewState] = useState<ViewState>({ kind: "LOADING" });
  const [interpretation, setInterpretation] = useState<AssistantInterpretation>();
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [draftStates, setDraftStates] = useState<Record<number, DraftActionState>>({});
  const [spokenResponse, setSpokenResponse] = useState<import("../../shared/speech-contracts").SpokenResponse>();
  const [contactForm, setContactForm] = useState<ContactFormRequest>();
  const [voiceMessage, setVoiceMessage] = useState<string>();
  /** What the last transcription heard. Transient renderer state only: never stored, logged or sent anywhere. */
  const [heardText, setHeardText] = useState<string>();
  const [shortcutHint, setShortcutHint] = useState<string>();
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const voiceRecorder = useRef<ManualVoiceRecorder | undefined>(undefined);
  const speechEndDetector = useRef<SpeechEndDetector | undefined>(undefined);
  const voiceStateReference = useRef(voiceState);
  const voiceStartInFlight = useRef(false);
  const voiceGeneration = useRef(0);
  const voiceUploadGeneration = useRef(-1);
  const voiceSubmission = useRef(createVoiceTranscriptSubmission());
  const interpretationInFlight = useRef(false);
  const [voiceShortcutStatus, setVoiceShortcutStatus] = useState<VoiceShortcutEffectiveStatus>();
  /** The typed command input is hidden until Ctrl+K. */
  const [commandOpen, setCommandOpen] = useState(false);
  /** False when spoken input cannot work (no OpenAI key): the microphone then explains it and typed input is offered. */
  const voiceConfigured = useRef(true);

  useEffect(() => {
    const loadTechnicalStatus = async (): Promise<void> => {
      const [statusResult, capabilitiesResult] = await Promise.all([window.ares.system.getStatus(), window.ares.system.getCapabilities()]);
      if (!statusResult.ok) return setViewState({ kind: "ERROR", userMessage: statusResult.error.userMessage });
      if (!capabilitiesResult.ok) return setViewState({ kind: "ERROR", userMessage: capabilitiesResult.error.userMessage });
      setViewState({ kind: "SUCCESS", status: statusResult.data, capabilities: capabilitiesResult.data });
      if (!capabilitiesResult.data.voice) {
        voiceConfigured.current = false;
        setVoiceMessage(LOCAL_MODE_HINT);
      }
    };
    void loadTechnicalStatus().catch(() => setViewState({ kind: "ERROR", userMessage: "No se pudo consultar el estado técnico de Ares." }));
  }, []);

  useEffect(() => {
    const loadVoicePreferences = async (): Promise<void> => {
      try {
        const result = await window.ares.settings.voice.get();
        if (!result.ok) return;
        setVoiceShortcutStatus(result.data.effectiveStatus);
        if (result.data.effectiveStatus === "UNAVAILABLE") setVoiceMessage("El atajo global no está disponible. Puedes usar el orbe.");
        if (result.data.effectiveStatus === "ACTIVE" && !shortcutHintShown) {
          shortcutHintShown = true;
          setShortcutHint(`Atajo: ${formatShortcutForDisplay(result.data.preferences.shortcut)}`);
          window.setTimeout(() => setShortcutHint(undefined), SHORTCUT_HINT_DURATION_MS);
        }
      } catch {
        // The shortcut hint is optional: without the preferences the view simply shows no hint.
      }
    };
    void loadVoicePreferences();
  }, []);

  /** A second press while recording stops it and sends what was recorded (Escape still cancels). */
  const sendRecording = (): void => {
    if (voiceStateReference.current === "RECORDING") voiceRecorder.current?.stop();
  };

  const cancelRecording = (): void => {
    orbAmplitudeSource.reset();
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
    const cleanup = bindRecordingCancellation(document, window, cancelRecording);
    return () => { voiceGeneration.current++; speechEndDetector.current?.dispose(); voiceRecorder.current?.dispose(); cleanup(); };
  }, []);
  useEffect(() => { voiceStateReference.current = voiceState; }, [voiceState]);
  useEffect(() => {
    if (voiceState !== "RECORDING") orbAmplitudeSource.reset();
  }, [voiceState]);

  const transcribeAudio = async (audio: Blob, mimeType: VoiceMimeType, durationMs: number, generation: number, attempt: VoiceAttempt): Promise<void> => {
    if (generation !== voiceGeneration.current || generation <= voiceUploadGeneration.current) { attempt.finish(); return; }
    voiceUploadGeneration.current = generation;
    try {
      const bytes = await audio.arrayBuffer();
      if (generation !== voiceGeneration.current) return;
      attempt.reach("ipc_submitted");
      const result = await window.ares.voice.transcribe({ audio: bytes, mimeType, durationMs });
      if (generation !== voiceGeneration.current) return;
      if (!result.ok) {
        attempt.fail(failureCodeForTranscription(result.error.code));
        if (result.error.code === VOICE_ERROR_CODES.configuration) {
          voiceConfigured.current = false;
          return setVoiceMessage(VOICE_NEEDS_KEY_MESSAGE);
        }
        return setVoiceMessage(result.error.userMessage);
      }
      attempt.reach("transcription_done");
      markCurrentTurn("transcription_done");
      attempt.finish();
      setHeardText(result.data.text);
      setVoiceMessage("Procesando instrucción…");
      await voiceSubmission.current.submit({
        generation, text: result.data.text, isCurrent: () => generation === voiceGeneration.current,
        showTranscript: () => undefined,
        interpret: (text) => submitInstruction(text, true, () => generation === voiceGeneration.current),
        propose: (index, draft) => requestProposal(index, draft, () => generation === voiceGeneration.current)
      });
      if (generation === voiceGeneration.current) setVoiceMessage("Instrucción procesada. Revisa el resultado y confirma si se requiere.");
    } catch {
      attempt.fail("VOICE_TRANSCRIPTION_FAILED");
      if (generation === voiceGeneration.current) setVoiceMessage(VOICE_CAPTURE_FAILURES.messageFor("VOICE_TRANSCRIPTION_FAILED"));
    } finally {
      attempt.finish();
      if (generation === voiceGeneration.current) { voiceStateReference.current = "IDLE"; setVoiceState("IDLE"); orbAmplitudeSource.reset(); }
    }
  };

  useEffect(() => {
    if (spokenResponse) markCurrentTurn("response_composed");
  }, [spokenResponse?.responseId]);

  useEffect(() => {
    if (heardText === undefined) return undefined;
    const timer = setTimeout(() => setHeardText(undefined), 8000);
    return () => clearTimeout(timer);
  }, [heardText]);

  const startRecording = async (fromGlobalShortcut = false): Promise<void> => {
    if (!voiceConfigured.current) {
      setVoiceMessage(VOICE_NEEDS_KEY_MESSAGE);
      return;
    }
    setHeardText(undefined);
    setSpokenResponse(undefined);
    orbAmplitudeSource.reset();
    if (voiceStateReference.current !== "IDLE" || voiceStartInFlight.current || interpretationInFlight.current) return;
    voiceStartInFlight.current = true;
    const generation = ++voiceGeneration.current;
    setVoiceMessage(fromGlobalShortcut ? "Ares está grabando." : undefined);
    // One privacy-safe diagnostic line per attempt (fixed enums and bounded numbers only), logged to the renderer console.
    const rawAttempt = createVoiceAttempt((line) => console.info(line));
    let peakRms = 0;
    let microphone: MicrophoneAccessStatus = "unknown";
    let levelAnalysisAvailable = true;
    const applyLevelFacts = (): void => rawAttempt.facts({ peak: peakLevelOf(peakRms, SPEECH_ACTIVITY_THRESHOLD), analysis: levelAnalysisAvailable ? "ok" : "unavailable" });
    const attempt: VoiceAttempt = {
      reach: rawAttempt.reach,
      facts: rawAttempt.facts,
      fail: (failure, errorName) => { applyLevelFacts(); rawAttempt.fail(failure, errorName); },
      finish: () => { applyLevelFacts(); rawAttempt.finish(); }
    };
    attempt.reach("shortcut_or_click");
    attempt.facts({ microphone });
    try {
      void window.ares.system.getStatus().then((status) => {
        microphone = status.ok ? normalizeMicrophoneAccess(status.data.microphoneAccess) : "unknown";
        attempt.facts({ microphone });
        attempt.reach("permission_checked");
      }).catch(() => undefined);
      void navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
        attempt.facts({ devices: devices.filter((device) => device.kind === "audioinput").length });
      }).catch(() => undefined);
    } catch {
      // Diagnostics never affect the attempt.
    }
    const browserMedia = navigator.mediaDevices;
    if (!browserMedia || typeof MediaRecorder === "undefined") {
      attempt.fail("VOICE_CAPTURE_RECORDER_UNSUPPORTED");
      setVoiceMessage(VOICE_CAPTURE_FAILURES.messageFor("VOICE_CAPTURE_RECORDER_UNSUPPORTED"));
      voiceStartInFlight.current = false;
      return;
    }
    let maximumWithoutSpeech = false;
    const detector = createSpeechEndDetector({
      // The orb maps this raw level to its own amplitude and writes it as a CSS variable, with no React re-render.
      onRms: (rms) => {
        peakRms = Math.max(peakRms, rms);
        if (generation === voiceGeneration.current) orbAmplitudeSource.pushMicRms(rms);
      },
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
      maximumDurationMs: LIVE_RECORDING_LIMIT_MS,
      diagnostics: attempt,
      getMicrophoneAccess: () => microphone,
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
      onProcessing: () => { detector.dispose(); orbAmplitudeSource.reset(); voiceStateReference.current = "PROCESSING"; setVoiceState("PROCESSING"); setVoiceMessage("Procesando…"); },
      onUnavailable: (message, reason) => {
        attempt.finish();
        orbAmplitudeSource.reset();
        voiceStartInFlight.current = false;
        setVoiceState("IDLE");
        setVoiceMessage(fromGlobalShortcut && reason === "USER_GESTURE_REQUIRED" ? "Para iniciar la grabación, usa el botón visible." : message);
      },
      isUserActivationActive: () => navigator.userActivation?.isActive ?? false,
      onCancelled: () => { detector.dispose(); orbAmplitudeSource.reset(); voiceStartInFlight.current = false; voiceStateReference.current = "IDLE"; setVoiceState("IDLE"); setVoiceMessage(maximumWithoutSpeech ? "No se entendió la instrucción." : "Grabación cancelada"); attempt.finish(); },
      onAudio: (recording, recordingMimeType, durationMs) => { detector.dispose(); orbAmplitudeSource.reset(); beginCurrentTurn((line) => console.info(line)); markCurrentTurn("recording_stopped"); void transcribeAudio(recording, recordingMimeType, durationMs, generation, attempt); }
    });
    await voiceRecorder.current.start();
    voiceStartInFlight.current = false;
  };

  useEffect(() => {
    if (!window.ares?.voice?.onGlobalShortcut) return;

    const controller = createGlobalVoiceShortcutController({
      getState: () => voiceStateReference.current,
      startRecording: () => { void startRecording(true); }, stopRecording: sendRecording
    });
    return window.ares.voice.onGlobalShortcut(controller.activate);
  }, []);

  // Ctrl+K opens the typed command input, which is hidden otherwise.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isCommandShortcut(event)) return;
      event.preventDefault();
      setCommandOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * A typed instruction goes through the same submission as a transcribed one (the same interpret call and the same proposals),
   * and is shown through the same transient «Escuché» line. It is not stored or logged.
   */
  const submitTypedInstruction = (text: string): void => {
    if (voiceStateReference.current !== "IDLE" || voiceStartInFlight.current || interpretationInFlight.current) {
      setVoiceMessage("Espera a que Ares termine.");
      return;
    }
    setSpokenResponse(undefined);
    const generation = ++voiceGeneration.current;
    setHeardText(text);
    setVoiceMessage("Procesando instrucción…");
    void voiceSubmission.current.submit({
      generation, text, isCurrent: () => generation === voiceGeneration.current,
      showTranscript: () => undefined,
      interpret: (instruction) => submitInstruction(instruction, true, () => generation === voiceGeneration.current),
      propose: (index, draft) => requestProposal(index, draft, () => generation === voiceGeneration.current)
    }).then(() => {
      if (generation === voiceGeneration.current) setVoiceMessage("Instrucción procesada. Revisa el resultado y confirma si se requiere.");
    }).catch(() => {
      if (generation === voiceGeneration.current) setVoiceMessage("No pude entenderte ahora. Inténtalo de nuevo en un momento.");
    });
  };

  const submitInstruction = async (instruction: string, automaticProposal = false, isCurrent = () => true): Promise<AssistantInterpretation | undefined> => {
    setSpokenResponse(undefined);
    if (interpretationInFlight.current || !isCurrent()) return;
    interpretationInFlight.current = true;
    setIsInterpreting(true); setInterpretation(undefined); setDraftStates({});
    try {
      const result = getInterpretationMessage(await window.ares.assistant.interpret({ text: instruction }));
      if (!isCurrent()) return;
      markCurrentTurn("interpretation_done");
      if (automaticProposal && result.state === "READY") setDraftStates(Object.fromEntries(result.drafts.map((_draft, index) => [index, { busy: true, resolved: false }])));
      setInterpretation(result);
      setSpokenResponse(result.spokenResponse);
      return result;
    } catch {
      if (isCurrent()) setVoiceMessage("No pude entenderte ahora. Inténtalo de nuevo en un momento.");
    } finally {
      interpretationInFlight.current = false;
      setIsInterpreting(false);
    }
  };

  // Main asks for this form while a contact is being saved; the renderer only ever receives a friendly name.
  useEffect(() => {
    if (!window.ares?.messaging?.onContactFormRequested) return;
    return window.ares.messaging.onContactFormRequested((request) => setContactForm(request));
  }, []);

  const submitContactForm = async (values: ContactFormValues): Promise<string | undefined> => {
    if (!contactForm) return "El formulario ya no está disponible.";
    try {
      const result = await window.ares.messaging.submitContactForm({ requestId: contactForm.requestId, ...values });
      if (result.ok) {
        setContactForm(undefined);
        return undefined;
      }
      if (result.error.code === "MESSAGING_PENDING_EXPIRED") {
        setContactForm(undefined);
        setVoiceMessage(result.error.userMessage);
      }
      return result.error.userMessage;
    } catch {
      return "No se pudo enviar el formulario.";
    }
  };

  const cancelContactForm = (): void => {
    const form = contactForm;
    setContactForm(undefined);
    if (form) void window.ares.messaging.cancelContactForm({ requestId: form.requestId }).catch(() => undefined);
  };

  const updateDraftState = (index: number, state: DraftActionState): void => setDraftStates((current) => ({ ...current, [index]: state }));

  const requestProposal = async (index: number, draft: ActionSubmission, isCurrent = () => true): Promise<void> => {
    if (!isCurrent()) return;
    setSpokenResponse(undefined);
    updateDraftState(index, { busy: true, resolved: false });
    try {
      const result = await window.ares.actions.propose(draft);
      if (!isCurrent()) return;
      markCurrentTurn("execution_done");
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
      if (isCurrent()) setVoiceMessage("No pude preparar eso. Inténtalo de nuevo.");
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
      setVoiceMessage(decision === "CONFIRM" ? "No se pudo confirmar la acción." : "No se pudo cancelar la acción.");
    }
  };

  const themeName = useThemeName();
  // The effective theme comes back through prefers-color-scheme, so nothing else is stored here.
  const toggleTheme = (preference: "light" | "dark"): void => {
    void window.ares.theme.setPreference({ preference }).catch(() => undefined);
  };
  const orbState = orbStateFor(voiceState, isInterpreting);
  const voiceLabel = voiceLabelFor(voiceState, isInterpreting);

  return <main className="ares-shell">
    <header className="ares-header">
      <span aria-label="Ares" className="wordmark">ARES</span>
      <ThemeToggle current={themeName} onToggle={toggleTheme} />
    </header>

    <AresView
      spokenResponse={spokenResponse}
      draftStates={draftStates}
      interpretation={interpretation}
      isInterpreting={isInterpreting}
      onSendRecording={sendRecording}
      onSpeechNotice={setVoiceMessage}
      commandOpen={commandOpen}
      onCommandSubmit={submitTypedInstruction}
      onCommandClose={() => setCommandOpen(false)}
      onPropose={(index, draft) => void propose(index, draft)}
      onResolveConfirmation={(index, confirmation, decision) => void resolveConfirmation(index, confirmation, decision)}
      onStartRecording={() => void startRecording()}
      orbState={orbState}
      technicalMessage={viewState.kind === "ERROR" ? viewState.userMessage : undefined}
      technicalState={viewState.kind}
      voiceLabel={voiceLabel}
      voiceMessage={voiceMessage}
      heardText={heardText}
      shortcutHint={shortcutHint}
      voiceShortcutStatus={voiceShortcutStatus}
      voiceState={voiceState}
    />

    {contactForm && <ContactFormDialog
      key={contactForm.requestId}
      onCancel={cancelContactForm}
      onSubmit={submitContactForm}
      request={contactForm}
    />}
  </main>;
};
