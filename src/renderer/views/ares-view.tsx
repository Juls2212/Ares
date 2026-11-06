import { useEffect, useRef, useState } from "react";

import type { AssistantInterpretation } from "../../shared/assistant-contracts";
import type { ActionSubmission, AwaitingActionConfirmation } from "../../shared/action-contracts";
import type { VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import { GlassOrb, type OrbOverlay, type OrbState } from "../components/glass-orb";
import { orbAccessibleName, visualKeyFor } from "../components/orb-visuals";
import { orbVisualsFor } from "../features/settings/color-schemes";
import { getReviewMode, InterpretationResult, type DraftActionState } from "../features/assistant/interpretation-result";
import { IdleGuidance } from "../features/assistant/idle-guidance";
import { responseAreaLabel } from "../features/assistant/response-area";
import { createResponseCoreReveal } from "../features/assistant/response-core-reveal";
import type { PlaybackEvent } from "../features/voice/response-playback";
import { ResponseSpeechControls } from "../features/voice/response-speech-controls";

type AresViewProperties = {
  spokenResponse?: import("../../shared/speech-contracts").SpokenResponse;
  technicalState: "LOADING" | "SUCCESS" | "ERROR";
  technicalMessage?: string;
  voiceLabel: string;
  voiceState: "IDLE" | "RECORDING" | "PROCESSING";
  voiceMessage?: string;
  orbState: OrbState;
  /** Id of the active color scheme; it only selects the orb palette (the CSS follows the same data-theme attribute). */
  scheme?: string;
  /** Spanish text announced once after a color change, for example «Color azul». */
  colorNotice?: string;
  voiceShortcutStatus?: VoiceShortcutEffectiveStatus;
  /** Discreet, temporary Spanish hint naming the active global shortcut. */
  shortcutHint?: string;
  isInterpreting: boolean;
  interpretation?: AssistantInterpretation;
  draftStates: Record<number, DraftActionState>;
  onStartRecording: () => void;
  onCancelRecording: () => void;
  onPropose: (index: number, draft: ActionSubmission) => void;
  onResolveConfirmation: (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL") => void;
};

type CoreVisualState = "IDLE" | "PLAYING" | "COMPLETED" | "FADING" | "FAILURE";

/** The cancellation notice is shown for 1.2 s and then fades back to the resting text. */
export const CANCELLED_NOTICE_MS = 1_200;
export const CANCELLATION_MESSAGE = "Grabación cancelada";
export const IDLE_PROMPT = "Toca el orbe para hablar";
export const RETRY_PROMPT = "Toca el orbe para reintentar";
/** A long answer gets a keyboard-reachable scroll area. */
export const LONG_RESPONSE_LENGTH = 180;

/** Splits «Atajo: Ctrl+Shift+Espacio» into its label and key caps; anything else is shown as plain text. */
export const parseShortcutHint = (hint: string | undefined): { label: string; keys: string[] } => {
  const match = /^([^:]+:)s*(.+)$/u.exec(hint ?? "");
  if (!match) return { label: "", keys: [] };
  const keys = match[2]!.split("+").map((key) => key.trim()).filter(Boolean);
  return keys.length > 0 ? { label: match[1]!, keys } : { label: "", keys: [] };
};

/** Native button activation uses the current renderer state without dispatching actions. */
export const createOrbInteraction = (
  state: OrbState,
  callbacks: { start: () => void; cancel: () => void; stop: () => void },
  reviewOpen = false
) => {
  const disabled = reviewOpen || state === "transcribing" || state === "interpreting" || state === "acting";
  return {
    disabled,
    label: orbAccessibleName(state, reviewOpen),
    activate: (): void => {
      if (disabled) return;
      if (state === "recording") callbacks.cancel();
      else if (state === "speaking") callbacks.stop();
      else callbacks.start();
    }
  };
};

export const AresView = ({
  spokenResponse,
  voiceState,
  voiceMessage,
  orbState,
  scheme,
  colorNotice,
  shortcutHint,
  isInterpreting,
  interpretation,
  draftStates,
  onStartRecording,
  onCancelRecording,
  onResolveConfirmation
}: AresViewProperties) => {
  const [coreResponseText, setCoreResponseText] = useState("");
  const [coreVisualState, setCoreVisualState] = useState<CoreVisualState>("IDLE");
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [cancelledNoticeActive, setCancelledNoticeActive] = useState(false);
  const responseReveal = useRef<ReturnType<typeof createResponseCoreReveal> | null>(null);
  const activeResponseId = useRef<string | undefined>(undefined);
  const orbReference = useRef<HTMLButtonElement>(null);
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
    ? "Escuchando…"
    : exclusiveCoreState === "PROCESSING"
      ? "Pensando…"
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
  const orbOverlay: OrbOverlay | undefined = reviewMode === "reinforced"
    ? "reinforced"
    : reviewMode === "standard"
      ? "confirm"
      : isCancellationNotice && cancelledNoticeActive && exclusiveCoreState === "IDLE" ? "cancelled" : undefined;
  const responsePhase = exclusiveCoreState === "PLAYING"
    ? "REVEALING"
    : exclusiveCoreState === "COMPLETED" ? "COMPLETED" : exclusiveCoreState === "FADING" ? "FADING" : undefined;
  const visibleCoreResponse = responsePhase ? coreResponseText : "";
  // The not-yet-revealed remainder keeps its space, so the text never reflows while it appears.
  const reservedCoreResponse = responsePhase ? coreResponse.slice(visibleCoreResponse.length) : "";
  const subText = exclusiveCoreState === "FAILURE" ? RETRY_PROMPT : undefined;
  const hintParts = parseShortcutHint(shortcutHint);
  // One polite announcement at a time: the final response (constant while it is revealed), else the current state or notice.
  const processedNotice = voiceMessage === "Instrucción procesada. Revisa el resultado y confirma si se requiere.";
  const announcement = coreResponse
    || (exclusiveCoreState === "LISTENING" || exclusiveCoreState === "PROCESSING" || exclusiveCoreState === "ACTING" ? coreLabel
      : exclusiveCoreState === "IDLE" && colorNotice ? colorNotice
      : exclusiveCoreState === "IDLE" && voiceMessage && !processedNotice ? idleText : "");

  const clearCoreForNewInteraction = (): void => {
    activeResponseId.current = undefined;
    setCoreVisualState("IDLE");
    responseReveal.current?.clear();
  };

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

  const handleStartRecording = (): void => {
    stopSpeechReference.current?.();
    clearCoreForNewInteraction();
    onStartRecording();
  };

  const orbInteraction = createOrbInteraction(resolvedOrbState, {
    start: handleStartRecording,
    cancel: onCancelRecording,
    stop: () => stopSpeechReference.current?.()
  }, needsReview);

  const visualKey = visualKeyFor(resolvedOrbState, orbOverlay);
  const showText = !needsReview;
  const showResponse = showText && Boolean(visibleCoreResponse || reservedCoreResponse);
  // Resting: nothing is happening, no answer, no card and the plain prompt is on screen.
  const resting = exclusiveCoreState === "IDLE" && coreLabel === IDLE_PROMPT && !coreResponse && !needsReview;
  const hintVisible = Boolean(shortcutHint && exclusiveCoreState === "IDLE" && !coreResponse && !needsReview);
  const areaLabel = showResponse ? responseAreaLabel(interpretation) : undefined;
  const longResponse = coreResponse.length > LONG_RESPONSE_LENGTH;

  return <section aria-label="Espacio de comandos Ares" className="command-layout" data-card={reviewMode} data-resting={resting || undefined} data-visual={visualKey}>
  <span aria-hidden="true" className="command-glow" style={{ ["--orb-glow" as string]: orbVisualsFor(scheme)[visualKey].glow }} />
  <div className="command-orb">
    <GlassOrb scheme={scheme} accessibleLabel={orbInteraction.label} controlRef={orbReference} disabled={orbInteraction.disabled} onActivate={orbInteraction.activate} overlay={orbOverlay} state={resolvedOrbState} />
  </div>
  <ResponseSpeechControls blocked={isInterpreting || voiceState !== "IDLE" || isActing} headless onPlaybackEvent={handlePlaybackEvent} onPlaybackState={handlePlaybackState} response={spokenResponse} stopRef={stopSpeechReference} />
  <div aria-hidden="true" className="command-text" data-response={showResponse || undefined} data-visible={showText || undefined}>
    {showText && !showResponse && coreLabel && <p className="command-text__label" data-emphasis={exclusiveCoreState !== "IDLE" || undefined}>{coreLabel}</p>}
    {showText && !showResponse && subText && <p className="command-text__sub">{subText}</p>}
    {showText && resting && !hintVisible && <IdleGuidance />}
    {areaLabel && <p className="command-text__chip">{areaLabel}</p>}
    {showResponse && <div className="command-response" data-long={longResponse || undefined} tabIndex={longResponse ? 0 : undefined}>
      <p>{visibleCoreResponse}<span className="command-response__reserved">{reservedCoreResponse}</span></p>
    </div>}
  </div>
  {hintVisible && <p className="shortcut-hint" role="note">
    {hintParts.label && <span>{hintParts.label}</span>}
    {hintParts.keys.map((key, index) => <span key={`${key}-${index}`}>{index > 0 && <span aria-hidden="true" className="shortcut-hint__plus">+</span>}<kbd>{key}</kbd></span>)}
    {hintParts.keys.length === 0 && shortcutHint}
  </p>}
  <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">{announcement}</div>
  {exclusiveCoreState === "FAILURE" && <p className="sr-only" role="alert">{coreLabel}</p>}

  <InterpretationResult draftStates={draftStates} interpretation={interpretation} onResolveConfirmation={onResolveConfirmation} returnFocusRef={orbReference} />
</section>;
};
