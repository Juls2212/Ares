import type { FormEvent } from "react";

import type { AssistantInterpretation } from "../../shared/assistant-contracts";
import type { ActionSubmission, AwaitingActionConfirmation } from "../../shared/action-contracts";
import type { VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import { voiceShortcutStatusLabels } from "../app/app-state";
import { ParticleOrb, type ParticleOrbState } from "../components/particle-orb";
import { InterpretationResult, type DraftActionState } from "../features/assistant/interpretation-result";
import { VoiceCommandControls } from "../features/voice/voice-command-controls";

type AresViewProperties = {
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
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onPropose: (index: number, draft: ActionSubmission) => void;
  onResolveConfirmation: (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL") => void;
};

export const AresView = ({
  technicalState,
  technicalMessage,
  voiceLabel,
  voiceState,
  voiceMessage,
  orbState,
  voiceShortcutStatus,
  instruction,
  isInterpreting,
  interpretation,
  draftStates,
  onInstructionChange,
  onInterpret,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  onPropose,
  onResolveConfirmation
}: AresViewProperties) => <section aria-label="Espacio de comandos Ares" className="command-layout">
  <aside className="support-panel support-panel--left">
    <p className="eyebrow">Sesión actual</p>
    <dl className="status-list">
      <div><dt>Texto</dt><dd>Listo para interpretar</dd></div>
      <div><dt>Voz</dt><dd>{voiceLabel}</dd></div>
      <div><dt>Atajo global</dt><dd>{voiceShortcutStatus ? voiceShortcutStatusLabels[voiceShortcutStatus] : "Verificando"}</dd></div>
      <div><dt>Confirmación</dt><dd>Cuando se requiere</dd></div>
    </dl>
    {technicalState === "ERROR" && <p className="panel-message">{technicalMessage}</p>}
    {technicalState === "LOADING" && <p className="panel-message">Comprobando la conexión segura.</p>}
    {technicalState === "SUCCESS" && <p className="panel-message">Ares está listo para preparar acciones supervisadas.</p>}
    <p className="support-note">Puedes escribir, dictar y revisar cada paso antes de continuar.</p>
  </aside>

  <section className="command-core">
    <ParticleOrb label={voiceLabel} state={orbState} />
    <div className="command-heading">
      <p className="eyebrow">Centro de mando personal</p>
      <h1>Ares</h1>
      <p>Escribe o dicta una intención. Tú decides cada siguiente paso.</p>
    </div>
    <section aria-label="Comando asistido" className="command-input-area">
      <VoiceCommandControls message={voiceMessage} onCancel={onCancelRecording} onStart={onStartRecording} onStop={onStopRecording} state={voiceState} />
      <form onSubmit={onInterpret}>
        <label className="sr-only" htmlFor="assistant-instruction">Instrucción para Ares</label>
        <textarea disabled={isInterpreting} id="assistant-instruction" onChange={(event) => onInstructionChange(event.target.value)} placeholder="Escribe una instrucción para Ares" value={instruction} />
        <button className="interpret-button" disabled={isInterpreting} type="submit">{isInterpreting ? "Interpretando..." : "Interpretar"}</button>
      </form>
    </section>
    <InterpretationResult draftStates={draftStates} interpretation={interpretation} onPropose={onPropose} onResolveConfirmation={onResolveConfirmation} />
  </section>

  <aside className="support-panel support-panel--right">
    <p className="eyebrow">Secuencia supervisada</p>
    <ol className="supervision-sequence">
      <li><span>01</span>Describe o dicta una intención.</li>
      <li><span>02</span>Revisa el borrador preparado.</li>
      <li><span>03</span>Confirma solo cuando se requiera.</li>
    </ol>
    <p className="support-note">Ares no realiza acciones por sí solo.</p>
  </aside>
</section>;
