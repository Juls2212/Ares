import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";

import {
  blobPlaybackRate,
  orbAmplitudeSource,
  syntheticSpeechAmplitude
} from "../features/voice/orb-amplitude";
import { orbVisualsFor } from "../features/settings/color-schemes";
import {
  orbAllowsMotion,
  visualKeyFor,
  type OrbOverlay,
  type OrbState,
  type OrbVisual
} from "./orb-visuals";

export type { OrbOverlay, OrbState } from "./orb-visuals";

type GlassOrbProps = {
  state: OrbState;
  /** Id of the color scheme whose palette is used; the animation values are the same in every scheme. */
  scheme?: string;
  overlay?: OrbOverlay;
  onActivate?: () => void;
  accessibleLabel?: string;
  disabled?: boolean;
  controlRef?: RefObject<HTMLButtonElement | null>;
};

type OrbStyle = CSSProperties & Record<
  "--orb-c1" | "--orb-c2" | "--orb-c3" | "--orb-c4" | "--orb-base" | "--orb-glow" | "--orb-halo" | "--orb-core" | "--orb-flow" | "--orb-scale",
  string
>;

/** Colors and numbers for one state, written as CSS custom properties so state changes cross-fade. */
export const orbStyleFor = (visual: OrbVisual): OrbStyle => ({
  "--orb-c1": visual.colors[0],
  "--orb-c2": visual.colors[1],
  "--orb-c3": visual.colors[2],
  "--orb-c4": visual.colors[3],
  "--orb-base": visual.base,
  "--orb-glow": visual.glow,
  "--orb-halo": String(visual.halo),
  "--orb-core": String(visual.core),
  "--orb-flow": String(visual.flow),
  "--orb-scale": String(visual.scale)
});

const BLOB_ANIMATIONS: ReadonlySet<string> = new Set(["ares-spin", "ares-morph"]);
const BLOBS = [0, 1, 2, 3] as const;

/**
 * Siri-style orb: halo, breathing layer, state scale, amplitude layer, and a sphere with four blurred blobs,
 * a swirl for thinking, a core and a highlight. Only transform, opacity and background-color are animated.
 * The microphone amplitude arrives from the existing silence detector and is written as a CSS variable
 * without re-rendering React.
 */
export const GlassOrb = ({ state, scheme, overlay, onActivate, accessibleLabel = "Toca para hablar", disabled, controlRef }: GlassOrbProps) => {
  const stageRef = useRef<HTMLSpanElement>(null);
  const amplitudeRef = useRef(0);
  const frameCounter = useRef(0);
  const visualKey = visualKeyFor(state, overlay);
  const visual = orbVisualsFor(scheme)[visualKey];
  const [documentHidden, setDocumentHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [reducedMotion, setReducedMotion] = useState(false);
  const speedRef = useRef(visual.speed);
  speedRef.current = visual.speed;

  /** Writes --amp and, every few updates, the blob speed: playbackRate = stateSpeed × (1 + amp × 1.2). */
  const applyAmplitude = (amplitude: number, forceRate = false): void => {
    const stage = stageRef.current;
    if (!stage) return;
    amplitudeRef.current = amplitude;
    stage.style.setProperty("--amp", amplitude.toFixed(3));
    frameCounter.current += 1;
    if (!forceRate && frameCounter.current % 3 !== 0) return;
    if (typeof stage.getAnimations !== "function") return;
    const rate = blobPlaybackRate(speedRef.current, amplitude);
    for (const animation of stage.getAnimations({ subtree: true })) {
      if (BLOB_ANIMATIONS.has((animation as CSSAnimation).animationName)) animation.playbackRate = rate;
    }
  };

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setReducedMotion(query?.matches ?? false);
    const onChange = (): void => setReducedMotion(query?.matches ?? false);
    const onVisibility = (): void => setDocumentHidden(document.hidden);
    query?.addEventListener?.("change", onChange);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      query?.removeEventListener?.("change", onChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // The state's own speed applies immediately, and the amplitude returns to zero when the state leaves its source.
  useEffect(() => {
    applyAmplitude(visual.amplitude === "none" ? 0 : amplitudeRef.current, true);
  }, [visualKey]);

  // Listening: the amplitude comes from the existing silence detector's analyser; no second stream is opened.
  useEffect(() => {
    if (visual.amplitude !== "mic") return;
    const unsubscribe = orbAmplitudeSource.subscribe((amplitude) => applyAmplitude(amplitude));
    return () => {
      unsubscribe();
      applyAmplitude(0, true);
    };
  }, [visual.amplitude]);

  // Speaking: a gentle synthetic pulse (the playback path is not tapped), paused while hidden or reduced.
  useEffect(() => {
    if (visual.amplitude !== "speech" || !orbAllowsMotion(reducedMotion, documentHidden)) return;
    let frame: number | undefined;
    const tick = (time: number): void => {
      applyAmplitude(syntheticSpeechAmplitude(time / 1000));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      applyAmplitude(0, true);
    };
  }, [visual.amplitude, reducedMotion, documentHidden]);

  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      aria-busy={visualKey === "processing"}
      disabled={disabled}
      onClick={onActivate}
      ref={controlRef}
      className="glass-orb"
      data-state={state}
      data-visual={visualKey}
      data-paused={documentHidden || undefined}
    >
      <span aria-hidden="true" className="glass-orb__stage" data-orb="" ref={stageRef} style={orbStyleFor(visual)}>
        <span className="glass-orb__halo glass-orb__halo--secondary" />
        <span className="glass-orb__halo glass-orb__halo--primary" />
        <span className="glass-orb__breathing">
          <span className="glass-orb__state-scale">
            <span className="glass-orb__amplitude">
              <span className="glass-orb__sphere">
                {BLOBS.map((index) => (
                  <span className={`glass-orb__rotator glass-orb__rotator--${index + 1}`} key={index}>
                    <span className={`glass-orb__blob glass-orb__blob--${index + 1}`} />
                  </span>
                ))}
                <span className="glass-orb__swirl" />
                <span className="glass-orb__core" />
                <span className="glass-orb__highlight" />
                <span className="glass-orb__edge" />
              </span>
            </span>
          </span>
        </span>
      </span>
      <span aria-hidden="true" className="glass-orb__ring" />
    </button>
  );
};
