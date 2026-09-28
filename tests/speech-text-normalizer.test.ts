import { describe, expect, it } from "vitest";
import { normalizeSpeechText } from "../src/main/voice/speech-text-normalizer";

describe("speech text normalization", () => {
  it("collapses spacing and removes presentation-only formatting", () => {
    expect(normalizeSpeechText("  # Resultado\n\n- **Listo**,\t agregué la tarea.  ")).toBe("Resultado Listo, agregué la tarea.");
  });

  it("preserves meaningful response content including dates and identifiers", () => {
    const text = "La cita es el 2026-09-27 a las 09:30 para Ares_1.";
    expect(normalizeSpeechText(text)).toBe(text);
  });
});
