import { useEffect, useState } from "react";

/** Fixed example phrases that cover the real capabilities; they are decorative and never read aloud. */
export const IDLE_GUIDANCE_PHRASES: readonly string[] = [
  "Prueba: “Abre Spotify”",
  "Prueba: “Busca un archivo llamado informe”",
  "Prueba: “Pon música de Soda Stereo”",
  "Prueba: “Escríbele a Mamá que llego tarde”",
  "Prueba: “Crea una carpeta llamada Fotos”",
  "Prueba: “¿Qué contactos tengo?”"
];

export const GUIDANCE_INTERVAL_MS = 6_000;

/** Greeting by local hour: 5–11 morning, 12–19 afternoon, otherwise night. No name is ever included. */
export const greetingForHour = (hour: number): string =>
  hour >= 5 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 20 ? "Buenas tardes" : "Buenas noches";

export const nextGuidanceIndex = (index: number, length = IDLE_GUIDANCE_PHRASES.length): number => (index + 1) % length;

type RotationOptions = {
  onAdvance: () => void;
  isHidden: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
  intervalMs?: number;
};

/** Advances on a fixed interval, but only while the document is visible; returns a function that stops it. */
export const createGuidanceRotation = ({ onAdvance, isHidden, subscribeVisibility, intervalMs = GUIDANCE_INTERVAL_MS }: RotationOptions): (() => void) => {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const sync = (): void => {
    stopTimer();
    if (!isHidden()) timer = setInterval(onAdvance, intervalMs);
  };
  const unsubscribe = subscribeVisibility(sync);
  sync();
  return () => {
    unsubscribe();
    stopTimer();
  };
};

/**
 * One quiet example phrase under the resting label. The new phrase fades in while the previous one fades out;
 * with reduced motion the CSS swaps them without animation. The block is decorative and hidden from assistive tech.
 */
export const IdleGuidance = ({ phrases = IDLE_GUIDANCE_PHRASES }: { phrases?: readonly string[] }) => {
  const [position, setPosition] = useState({ current: 0, previous: undefined as number | undefined });

  useEffect(() => createGuidanceRotation({
    onAdvance: () => setPosition((state) => ({ current: nextGuidanceIndex(state.current, phrases.length), previous: state.current })),
    isHidden: () => document.hidden,
    subscribeVisibility: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    }
  }), [phrases.length]);

  return <div aria-hidden="true" className="idle-guidance">
    {position.previous !== undefined && <p className="idle-guidance__item" data-leaving="" key={`out-${position.previous}-${position.current}`}>{phrases[position.previous]}</p>}
    <p className="idle-guidance__item" key={`in-${position.current}`}>{phrases[position.current]}</p>
  </div>;
};
