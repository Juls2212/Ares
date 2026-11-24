import { useEffect, useRef, useState } from "react";

import type { AssistantInterpretation } from "../../shared/assistant-contracts";
import type { ActionSubmission, AwaitingActionConfirmation } from "../../shared/action-contracts";
import type { VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import { HexBackground, OrbCanvas } from "../orb/orb-canvas";
import { orbVisualStateFor, orbSignal, setOrbLevel, type OrbState } from "../orb/orb-runtime";
import { getReviewMode, InterpretationResult, type DraftActionState } from "../features/assistant/interpretation-result";
import { responseAreaLabel } from "../features/assistant/response-area";
import { createResponseCoreReveal } from "../features/assistant/response-core-reveal";
import { orbAmplitudeSource } from "../features/voice/orb-amplitude";
import type { PlaybackEvent } from "../features/voice/response-playback";
import { finishCurrentTurn, markCurrentTurn } from "../../shared/turn-timing";
import { ResponseSpeechControls } from "../features/voice/response-speech-controls";
import { CommandInput } from "../features/assistant/command-input";

export type { OrbState } from "../orb/orb-runtime";

type AresViewProperties = {
  spokenResponse?: import("../../shared/speech-contracts").SpokenResponse;
  technicalState: "LOADING" | "SUCCESS" | "ERROR";
  technicalMessage?: string;
  voiceLabel: string;
  voiceState: "IDLE" | "RECORDING" | "PROCESSING";
  voiceMessage?: string;
  /** Transient transcript of the last utterance; shown for a few seconds and never persisted. */
  heardText?: string;
  orbState: OrbState;
  voiceShortcutStatus?: VoiceShortcutEffectiveStatus;
  /** Spanish text naming the active global shortcut, for the caption under the microphone button. */
  shortcutHint?: string;
  isInterpreting: boolean;
  interpretation?: AssistantInterpretation;
  draftStates: Record<number, DraftActionState>;
  onStartRecording: () => void;
  /** Stops the recording and sends what was recorded. */
  onSendRecording: () => void;
  /** A bounded Spanish notice from the speech output (for example, no Spanish voice installed). */
  onSpeechNotice?: (message: string) => void;
  /** Typed input: whether the field is open, what it submits, and how it closes. */
  commandOpen?: boolean;
  onCommandSubmit?: (text: string) => void;
  onCommandClose?: () => void;
  onPropose: (index: number, draft: ActionSubmission) => void;
  onResolveConfirmation: (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL") => void;
};

type CoreVisualState = "IDLE" | "PLAYING" | "COMPLETED" | "FADING" | "FAILURE";

/** The cancellation notice is shown for 1.2 s and then fades back to the resting text. */
export const CANCELLED_NOTICE_MS = 1_200;
export const CANCELLATION_MESSAGE = "Grabación cancelada";
export const IDLE_PROMPT = "Toca el orbe para hablar";
export const RETRY_PROMPT = "Toca el orbe para reintentar";
export const DEFAULT_SHORTCUT_CAPTION = "CTRL + ALT + ESPACIO";
/** A long answer gets a keyboard-reachable scroll area. */
export const LONG_RESPONSE_LENGTH = 180;

/** Splits «Atajo: Ctrl+Shift+Espacio» into its label and key caps; anything else is shown as plain text. */
export const parseShortcutHint = (hint: string | undefined): { label: string; keys: string[] } => {
  const match = /^([^:]+:)s*(.+)$/u.exec(hint ?? "");
  if (!match) return { label: "", keys: [] };
  const keys = match[2]!.split("+").map((key) => key.trim()).filter(Boolean);
  return keys.length > 0 ? { label: match[1]!, keys } : { label: "", keys: [] };
};

/** The caption under the button: the active shortcut as «CTRL + ALT + ESPACIO», or that default when none is known. */
export const shortcutCaption = (hint: string | undefined): string => {
  const { keys } = parseShortcutHint(hint);
  return keys.length > 0 ? keys.map((key) => key.toLocaleUpperCase("es")).join(" + ") : DEFAULT_SHORTCUT_CAPTION;
};

/** The label of the one button, by state. */
export const micLabelFor = (state: OrbState, reviewOpen = false): string => {
  if (reviewOpen) return "Esperando tu confirmación";
  switch (state) {
    case "recording": return "Enviar lo que dije";
    case "speaking": return "Detener voz";
    case "transcribing":
    case "interpreting":
    case "acting": return "Procesando";
    default: return "Hablar con Ares";
  }
};

/** Native button activation uses the current renderer state without dispatching actions. */
export const createOrbInteraction = (
  state: OrbState,
  callbacks: { start: () => void; send: () => void; stop: () => void },
  reviewOpen = false
) => {
  const disabled = reviewOpen || state === "transcribing" || state === "interpreting" || state === "acting";
  return {
    disabled,
    label: micLabelFor(state, reviewOpen),
    activate: (): void => {
      if (disabled) return;
      if (state === "recording") callbacks.send();
      else if (state === "speaking") callbacks.stop();
      else callbacks.start();
    }
  };
};

/** How the status block is styled: an error or a question gets its own label color and word. */
export type StatusKind = "error" | "clarification";

export const statusKindFor = (input: { orbState: OrbState; busy: boolean; interpretationState?: string; reviewOpen: boolean }): StatusKind | undefined => {
  if (input.busy) return undefined;
  if (input.orbState === "error" || input.interpretationState === "UNAVAILABLE") return "error";
  if (input.interpretationState === "NEEDS_CLARIFICATION" && !input.reviewOpen) return "clarification";
  return undefined;
};

/** The state word above the main message. */
export const stateLabelFor = (state: OrbState): string => {
  switch (state) {
    case "recording": return "Escuchando";
    case "transcribing":
    case "interpreting":
    case "acting": return "Pensando";
    case "speaking": return "Respondiendo";
    case "error": return "Atención";
    default: return "Listo";
  }
};

const MicIcon = ({ state }: { state: OrbState }) => {
  if (state === "recording") return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
  if (state === "speaking") return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect height="12" rx="2" width="12" x="6" y="6" /></svg>;
  if (state === "transcribing" || state === "interpreting" || state === "acting") return <svg aria-hidden="true" className="mic__busy" focusable="false" viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8" /></svg>;
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect height="11" rx="3" width="6" x="9" y="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
};

export const AresView = ({
  spokenResponse,
  voiceState,
  voiceMessage,
  heardText,
  orbState,
  shortcutHint,
  isInterpreting,
  interpretation,
  draftStates,
  onStartRecording,
  onSendRecording,
  onSpeechNotice,
  commandOpen = false,
  onCommandSubmit,
  onCommandClose,
  onResolveConfirmation
}: AresViewProperties) => {
  const [coreResponseText, setCoreResponseText] = useState("");
  const [coreVisualState, setCoreVisualState] = useState<CoreVisualState>("IDLE");
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [cancelledNoticeActive, setCancelledNoticeActive] = useState(false);
  const responseReveal = useRef<ReturnType<typeof createResponseCoreReveal> | null>(null);
  const activeResponseId = useRef<string | undefined>(undefined);
  const micReference = useRef<HTMLButtonElement>(null);
  const stopSpeechReference = useRef<(() => void) | undefined>(undefined);
  const reviewMode = getReviewMode(interpretation, draftStates);
  const needsReview = reviewMode !== undefined;
  const isActing = Object.values(draftStates).some((state) => state.busy);
  const coreResponse = spokenResponse?.text ?? "";
  const exclusiveCoreState = voiceState === "RECORDING"
    ? "LISTENING"
    : voiceState === "PROCESSING" || isInterpreting || isGeneratingSpeech
      ? "PROCESSING"
      : isActing
        ? "ACTING"
        : coreVisualState;
  const isCancellationNotice = voiceMessage === CANCELLATION_MESSAGE;
  const idleText = isCancellationNotice
    ? (cancelledNoticeActive ? "Cancelado" : IDLE_PROMPT)
    : voiceMessage === "Instrucción procesada. Revisa el resultado y confirma si se requiere."
      ? IDLE_PROMPT
      : voiceMessage ?? IDLE_PROMPT;
  const coreLabel = exclusiveCoreState === "LISTENING"
    ? "Te escucho…"
    : exclusiveCoreState === "PROCESSING"
      ? "Un momento…"
      : exclusiveCoreState === "ACTING"
        ? "Ares está actuando…"
        : exclusiveCoreState === "FAILURE" ? "No se pudo reproducir la voz."
          : exclusiveCoreState === "PLAYING" ? ""
            : exclusiveCoreState === "IDLE" ? idleText : "";
  const visibleOrbState: OrbState = exclusiveCoreState === "LISTENING"
    ? "recording"
    : exclusiveCoreState === "PROCESSING"
      ? "transcribing"
      : exclusiveCoreState === "ACTING"
        ? "acting"
        : exclusiveCoreState === "PLAYING" ? "speaking" : orbState;
  const resolvedOrbState: OrbState = exclusiveCoreState === "FAILURE" ? "error" : visibleOrbState;
  const responsePhase = exclusiveCoreState === "PLAYING"
    ? "REVEALING"
    : exclusiveCoreState === "COMPLETED" ? "COMPLETED" : exclusiveCoreState === "FADING" ? "FADING" : undefined;
  const visibleCoreResponse = responsePhase ? coreResponseText : "";
  // The not-yet-revealed remainder keeps its space, so the text never reflows while it appears.
  const reservedCoreResponse = responsePhase ? coreResponse.slice(visibleCoreResponse.length) : "";
  const subText = exclusiveCoreState === "FAILURE" ? RETRY_PROMPT : undefined;
  // One polite announcement at a time: the final response (constant while it is revealed), else the current state or notice.
  const processedNotice = voiceMessage === "Instrucción procesada. Revisa el resultado y confirma si se requiere.";
  const announcement = coreResponse
    || (exclusiveCoreState === "LISTENING" || exclusiveCoreState === "PROCESSING" || exclusiveCoreState === "ACTING" ? coreLabel
      : exclusiveCoreState === "IDLE" && voiceMessage && !processedNotice ? idleText : "");

  const clearCoreForNewInteraction = (): void => {
    activeResponseId.current = undefined;
    setCoreVisualState("IDLE");
    responseReveal.current?.clear();
  };

  // The canvas loop reads this mutable signal; changing it never re-renders anything.
  useEffect(() => { orbSignal.state = orbVisualStateFor(resolvedOrbState); }, [resolvedOrbState]);
  // The microphone level comes from the analyser the silence detector already runs; no second stream is opened.
  useEffect(() => orbAmplitudeSource.subscribe((amplitude) => setOrbLevel(orbSignal, amplitude, performance.now())), []);

  useEffect(() => {
    const controller = createResponseCoreReveal({
      onTextChange: setCoreResponseText,
      onCompletionFading: () => setCoreVisualState("FADING"),
      onCompletionCleared: () => setCoreVisualState("IDLE")
    });
    responseReveal.current = controller;
    return () => controller.dispose();
  }, []);

  useEffect(() => {
    activeResponseId.current = spokenResponse?.responseId;
    setCoreVisualState("IDLE");
    responseReveal.current?.replace(coreResponse);
    if (!spokenResponse && coreResponse) {
      setCoreVisualState("COMPLETED");
      responseReveal.current?.showFull();
    }
  }, [coreResponse, spokenResponse?.responseId, spokenResponse]);

  useEffect(() => {
    if (voiceState !== "IDLE" || isInterpreting) clearCoreForNewInteraction();
  }, [isInterpreting, voiceState]);

  // «Cancelado» stays 1.2 s, then the resting text fades back in (visual only; nothing else changes).
  useEffect(() => {
    if (!isCancellationNotice) {
      setCancelledNoticeActive(false);
      return;
    }
    setCancelledNoticeActive(true);
    const timer = window.setTimeout(() => setCancelledNoticeActive(false), CANCELLED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [isCancellationNotice, voiceMessage]);

  const handlePlaybackEvent = (event: PlaybackEvent): void => {
    if (event.responseId !== activeResponseId.current) return;
    if (event.type === "PLAYING") markCurrentTurn("playback_started");
    finishCurrentTurn();
    if (event.type === "PLAYING") {
      setCoreVisualState("PLAYING");
      responseReveal.current?.handlePlaybackEvent(event);
      return;
    }
    setCoreVisualState(event.type === "FAILED" ? "FAILURE" : "COMPLETED");
    responseReveal.current?.handlePlaybackEvent(event);
  };

  const handlePlaybackState = (state: "IDLE" | "LOADING" | "PLAYING" | "FINISHED" | "ERROR"): void => {
    setIsGeneratingSpeech(state === "LOADING");
    if (state !== "LOADING") return;
    setCoreVisualState("IDLE");
    responseReveal.current?.hide();
  };

  // Closing the typed input returns focus to the one microphone button.
  const wasCommandOpen = useRef(false);
  useEffect(() => {
    if (wasCommandOpen.current && !commandOpen) micReference.current?.focus();
    wasCommandOpen.current = commandOpen;
  }, [commandOpen]);

  const handleStartRecording = (): void => {
    stopSpeechReference.current?.();
    clearCoreForNewInteraction();
    onStartRecording();
  };

  const interaction = createOrbInteraction(resolvedOrbState, {
    start: handleStartRecording,
    send: onSendRecording,
    stop: () => stopSpeechReference.current?.()
  }, needsReview);

  const showText = !needsReview;
  const showResponse = showText && Boolean(visibleCoreResponse || reservedCoreResponse);
  const areaLabel = showResponse ? responseAreaLabel(interpretation) : undefined;
  const longResponse = coreResponse.length > LONG_RESPONSE_LENGTH;
  const statusKind = statusKindFor({
    orbState: resolvedOrbState,
    busy: exclusiveCoreState === "LISTENING" || exclusiveCoreState === "PROCESSING" || exclusiveCoreState === "ACTING",
    interpretationState: interpretation?.state,
    reviewOpen: needsReview
  });
  // The word itself says it, so the styling never relies on color alone.
  const stateLabel = statusKind === "error" ? "Atención" : statusKind === "clarification" ? "Pregunta" : stateLabelFor(resolvedOrbState);

  return <section aria-label="Espacio de comandos Ares" className="hud" data-card={reviewMode} data-orb={resolvedOrbState}>
    <HexBackground />
    <div className="hud__stage">
      <OrbCanvas onActivate={interaction.activate} />
    </div>
    <ResponseSpeechControls blocked={isInterpreting || voiceState !== "IDLE" || isActing} headless onNotice={onSpeechNotice} onPlaybackEvent={handlePlaybackEvent} onPlaybackState={handlePlaybackState} response={spokenResponse} stopRef={stopSpeechReference} />
    <div aria-hidden="true" className="hud__status" data-kind={statusKind} data-response={showResponse || undefined} data-visible={showText || undefined}>
      <p className="hud__state">{stateLabel}</p>
      {showText && !showResponse && coreLabel && <p className="hud__main" data-emphasis={exclusiveCoreState !== "IDLE" || undefined}>{coreLabel}</p>}
      {showText && !showResponse && subText && <p className="hud__sub">{subText}</p>}
      {areaLabel && <p className="hud__chip">{areaLabel}</p>}
      {showResponse && <div className="hud__response" data-long={longResponse || undefined} tabIndex={longResponse ? 0 : undefined}>
        <p>{visibleCoreResponse}<span className="hud__response-reserved">{reservedCoreResponse}</span></p>
      </div>}
    </div>
    {/* The line keeps its space when empty, so the orb does not move when a transcript appears or goes away. */}
    {heardText
      ? <p aria-atomic="true" aria-live="polite" className="heard-line" role="status">{`Escuché: «${heardText}»`}</p>
      : <p aria-hidden="true" className="heard-line" />}
    <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">{announcement}</div>
    {exclusiveCoreState === "FAILURE" && <p className="sr-only" role="alert">{coreLabel}</p>}

    {commandOpen && onCommandSubmit && onCommandClose && <CommandInput onClose={onCommandClose} onSubmit={onCommandSubmit} />}

    <footer className="hud__bar">
      <button
        aria-busy={interaction.disabled && !needsReview}
        aria-label={interaction.label}
        className="mic"
        data-state={resolvedOrbState}
        disabled={interaction.disabled}
        onClick={interaction.activate}
        ref={micReference}
        type="button"
      >
        <MicIcon state={resolvedOrbState} />
      </button>
      <p aria-hidden="true" className="hud__caption">{shortcutCaption(shortcutHint)}</p>
    </footer>

    <InterpretationResult draftStates={draftStates} interpretation={interpretation} onResolveConfirmation={onResolveConfirmation} returnFocusRef={micReference} />
  </section>;
};
