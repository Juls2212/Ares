import { useEffect, useRef, useState } from "react";

import type { AssistantInterpretation } from "../../shared/assistant-contracts";
import type { ActionSubmission, AwaitingActionConfirmation } from "../../shared/action-contracts";
import type { VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import { ParticleOrb, type ParticleOrbState } from "../components/particle-orb";
import { hasAssistantReview, InterpretationResult, type DraftActionState } from "../features/assistant/interpretation-result";
import { createResponseCoreReveal } from "../features/assistant/response-core-reveal";
import type { PlaybackEvent } from "../features/voice/response-playback";
import { ResponseSpeechControls } from "../features/voice/response-speech-controls";

type AresViewProperties = {
  spokenResponse?: import("../../shared/speech-contracts").SpokenResponse;
  technicalState: "LOADING" | "SUCCESS" | "ERROR";
  technicalMessage?: string;
  voiceLabel: string;
  voiceLevel?: number;
  voiceState: "IDLE" | "RECORDING" | "PROCESSING";
  voiceMessage?: string;
  orbState: ParticleOrbState;
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

/** Native button activation uses the current renderer state without dispatching actions. */
export const createOrbInteraction = (
  state: ParticleOrbState,
  callbacks: { start: () => void; cancel: () => void; stop: () => void },
  reviewOpen = false
) => {
  const disabled = reviewOpen || state === "transcribing" || state === "interpreting" || state === "acting";
  const label = state === "recording" ? "Cancelar grabación" : state === "speaking" ? "Detener voz" : disabled ? "Ares está procesando" : "Hablar con Ares";
  return {
    disabled,
    label,
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
  voiceLevel = 0,
  voiceState,
  voiceMessage,
  orbState,
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
  const responseReveal = useRef<ReturnType<typeof createResponseCoreReveal> | null>(null);
  const activeResponseId = useRef<string | undefined>(undefined);
  const orbReference = useRef<HTMLButtonElement>(null);
  const stopSpeechReference = useRef<(() => void) | undefined>(undefined);
  const needsReview = hasAssistantReview(interpretation, draftStates);
  const isActing = Object.values(draftStates).some((state) => state.busy);
  const coreResponse = spokenResponse?.text ?? "";
  const exclusiveCoreState = voiceState === "RECORDING"
    ? "LISTENING"
    : voiceState === "PROCESSING" || isInterpreting || isGeneratingSpeech
      ? "PROCESSING"
      : isActing
        ? "ACTING"
      : coreVisualState;
  const coreLabel = exclusiveCoreState === "LISTENING"
    ? "Escuchando…"
    : exclusiveCoreState === "PROCESSING"
      ? "Procesando…"
      : exclusiveCoreState === "ACTING"
        ? "Ares está actuando…"
      : exclusiveCoreState === "FAILURE" ? "No se pudo reproducir la voz."
        : exclusiveCoreState === "PLAYING" ? "Toca para detener"
          : exclusiveCoreState === "IDLE" ? (voiceMessage === "Instrucción procesada. Revisa el resultado y confirma si se requiere." ? "Toca para hablar" : voiceMessage ?? "Toca para hablar") : "";
  const visibleOrbState: ParticleOrbState = exclusiveCoreState === "LISTENING"
    ? "recording"
    : exclusiveCoreState === "PROCESSING"
      ? "transcribing"
      : exclusiveCoreState === "ACTING"
        ? "acting"
      : exclusiveCoreState === "PLAYING" ? "speaking" : orbState;
  const resolvedOrbState = exclusiveCoreState === "FAILURE" ? "error" : visibleOrbState;
  const responsePhase = exclusiveCoreState === "PLAYING"
    ? "REVEALING"
    : exclusiveCoreState === "COMPLETED" ? "COMPLETED" : exclusiveCoreState === "FADING" ? "FADING" : undefined;
  const visibleCoreResponse = responsePhase ? coreResponseText : "";

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

  return <section aria-label="Espacio de comandos Ares" className="command-layout">
  <section className="command-core">
    <div className="command-instrument">
      <div className="command-core__visual">
        <ParticleOrb accessibleLabel={orbInteraction.label} controlRef={orbReference} disabled={orbInteraction.disabled} label={coreLabel} onActivate={orbInteraction.activate} responsePhase={responsePhase} responseText={visibleCoreResponse} state={resolvedOrbState} voiceLevel={voiceLevel} />
      </div>
      <ResponseSpeechControls blocked={isInterpreting || voiceState !== "IDLE" || isActing} headless onPlaybackEvent={handlePlaybackEvent} onPlaybackState={handlePlaybackState} response={spokenResponse} stopRef={stopSpeechReference} />
      {shortcutHint && exclusiveCoreState === "IDLE" && !coreResponse && <p className="shortcut-hint" role="note">{shortcutHint}</p>}
      {coreResponse && <p aria-live="polite" className="sr-only">{coreResponse}</p>}
      {coreLabel && <p role="status" className="sr-only">{coreLabel}</p>}
    </div>
  </section>

  <InterpretationResult draftStates={draftStates} interpretation={interpretation} onResolveConfirmation={onResolveConfirmation} returnFocusRef={orbReference} />
</section>;
};
