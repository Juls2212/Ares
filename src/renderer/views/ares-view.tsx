import { type FormEvent, useEffect, useRef, useState } from "react";

import type { AssistantInterpretation } from "../../shared/assistant-contracts";
import type { ActionSubmission, AwaitingActionConfirmation } from "../../shared/action-contracts";
import type { VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import { ParticleOrb, type ParticleOrbState } from "../components/particle-orb";
import {
  AresTodaySummaryPanel,
  AresUpcomingEventsPanel
} from "../features/assistant/ares-information-panels";
import { loadAresToday, type AresTodayState } from "../features/assistant/ares-today-summary";
import { loadAresHabitSummary, type AresHabitSummaryState } from "../features/assistant/ares-habit-summary";
import { hasAssistantReview, InterpretationResult, type DraftActionState } from "../features/assistant/interpretation-result";
import { createResponseCoreReveal } from "../features/assistant/response-core-reveal";
import type { PlaybackEvent } from "../features/voice/response-playback";
import { VoiceCommandControls } from "../features/voice/voice-command-controls";
import { ResponseSpeechControls } from "../features/voice/response-speech-controls";

type AresViewProperties = {
  spokenResponse?: import("../../shared/speech-contracts").SpokenResponse;
  technicalState: "LOADING" | "SUCCESS" | "ERROR";
  technicalMessage?: string;
  voiceLabel: string;
  voiceState: "IDLE" | "RECORDING" | "PROCESSING";
  voiceMessage?: string;
  orbState: ParticleOrbState;
  voiceShortcutStatus?: VoiceShortcutEffectiveStatus;
  instruction: string;
  isInterpreting: boolean;
  interpretation?: AssistantInterpretation;
  draftStates: Record<number, DraftActionState>;
  onInstructionChange: (instruction: string) => void;
  onInterpret: (event: FormEvent<HTMLFormElement>) => void;
  onStartRecording: () => void;
  onCancelRecording: () => void;
  onPropose: (index: number, draft: ActionSubmission) => void;
  onResolveConfirmation: (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL") => void;
};

type CoreVisualState = "IDLE" | "PLAYING" | "COMPLETED" | "FADING" | "FAILURE";

export const AresView = ({
  spokenResponse,
  voiceState,
  voiceMessage,
  orbState,
  instruction,
  isInterpreting,
  interpretation,
  draftStates,
  onInstructionChange,
  onInterpret,
  onStartRecording,
  onCancelRecording,
  onPropose,
  onResolveConfirmation
}: AresViewProperties) => {
  const [today, setToday] = useState<AresTodayState>({ kind: "LOADING" });
  const [habits, setHabits] = useState<AresHabitSummaryState>({ kind: "LOADING" });
  const [coreResponseText, setCoreResponseText] = useState("");
  const [coreVisualState, setCoreVisualState] = useState<CoreVisualState>("IDLE");
  const responseReveal = useRef<ReturnType<typeof createResponseCoreReveal> | null>(null);
  const activeResponseId = useRef<string | undefined>(undefined);
  const instructionReference = useRef<HTMLTextAreaElement>(null);
  const needsReview = hasAssistantReview(interpretation, draftStates);
  const resolvedActionMessage = interpretation?.drafts
    .map((_draft, index) => draftStates[index])
    .find((state) => state?.resolved && !state.confirmation)?.userMessage;
  const coreResponse = spokenResponse?.text ?? resolvedActionMessage ?? (!needsReview ? interpretation?.summary ?? "" : "");
  const exclusiveCoreState = voiceState === "RECORDING"
    ? "LISTENING"
    : voiceState === "PROCESSING" || isInterpreting
      ? "PROCESSING"
      : coreVisualState;
  const coreLabel = exclusiveCoreState === "LISTENING"
    ? "Escuchando…"
    : exclusiveCoreState === "PROCESSING"
      ? "Procesando…"
      : exclusiveCoreState === "FAILURE" ? "No se pudo reproducir la voz." : "";
  const visibleOrbState: ParticleOrbState = exclusiveCoreState === "LISTENING"
    ? "recording"
    : exclusiveCoreState === "PROCESSING"
      ? "transcribing"
      : exclusiveCoreState === "PLAYING" ? "speaking" : orbState;
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
    let isCurrent = true;
    void loadAresToday(window.ares?.planner).then((result) => {
      if (isCurrent) setToday(result);
    });
    return () => { isCurrent = false; };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    void loadAresHabitSummary(window.ares?.habits).then((result) => {
      if (isCurrent) setHabits(result);
    });
    return () => { isCurrent = false; };
  }, []);

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
    if (state !== "LOADING") return;
    setCoreVisualState("IDLE");
    responseReveal.current?.hide();
  };

  const handleStartRecording = (): void => {
    clearCoreForNewInteraction();
    onStartRecording();
  };

  const handleInterpret = (event: FormEvent<HTMLFormElement>): void => {
    clearCoreForNewInteraction();
    onInterpret(event);
  };

  return <section aria-label="Espacio de comandos Ares" className="command-layout">
  <AresTodaySummaryPanel habits={habits} today={today} />

  <section className="command-core">
    <div className="command-heading">
      <p className="eyebrow">Centro de mando personal</p>
      <h1>Ares</h1>
      <p>Escribe o dicta una intención. Tú decides cada siguiente paso.</p>
    </div>
    <div className="command-instrument">
      <div className="command-core__visual">
        <ParticleOrb label={coreLabel} responsePhase={responsePhase} responseText={visibleCoreResponse} state={visibleOrbState} />
      </div>
      <div className="command-instrument__speech">
        <ResponseSpeechControls blocked={isInterpreting || voiceState !== "IDLE" || Object.values(draftStates).some((state) => state.busy)} onPlaybackEvent={handlePlaybackEvent} onPlaybackState={handlePlaybackState} response={spokenResponse} />
      </div>
      {coreResponse && <p aria-live="polite" className="sr-only">{coreResponse}</p>}
      <span aria-hidden="true" className="command-instrument__axis" />
      <span aria-hidden="true" className="command-instrument__anchor" />
    </div>
    <section aria-label="Comando asistido" className="command-input-area command-entry-zone command-dock">
      <p className="eyebrow command-dock__label">Entrada de comando</p>
      <VoiceCommandControls disabled={isInterpreting} processingInstruction={isInterpreting || voiceMessage === "Procesando instrucción…"} message={voiceMessage} onCancel={onCancelRecording} onStart={handleStartRecording} state={voiceState} />
      <form className="command-entry-form" onSubmit={handleInterpret}>
        <label className="sr-only" htmlFor="assistant-instruction">Instrucción para Ares</label>
        <textarea disabled={isInterpreting} id="assistant-instruction" onChange={(event) => onInstructionChange(event.target.value)} placeholder="Escribe una instrucción para Ares" ref={instructionReference} value={instruction} />
        <button className="interpret-button" disabled={isInterpreting || voiceState !== "IDLE"} type="submit">{isInterpreting ? "Interpretando..." : "Interpretar"}</button>
      </form>
    </section>
  </section>

  <InterpretationResult draftStates={draftStates} interpretation={interpretation} onPropose={onPropose} onResolveConfirmation={onResolveConfirmation} returnFocusRef={instructionReference} />

  <AresUpcomingEventsPanel today={today} />

</section>;
};
