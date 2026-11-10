import { describe, expect, it } from "vitest";

import { readSource } from "./helpers/read-source";

describe("mounted Ares wiring", () => {
  it("mounts the orb view without any text input, browser speech control or old voice button", () => {
    const view = readSource("src/renderer/views/ares-view.tsx");
    expect(view).not.toContain("BrowserSpeechControls");
    expect(view).not.toContain("VoiceCommandControls");
    expect(view).toContain("<GlassOrb");
    expect(view).not.toContain("assistant-instruction");
  });

  it("keeps interpretation and confirmation as explicit calls from the app and never mounts the calendar", () => {
    const app = readSource("src/renderer/app/App.tsx");
    expect(app).toContain("window.ares.assistant.interpret({ text: instruction })");
    expect(app).toContain("window.ares.actions.confirm(confirmation.confirmationId)");
    expect(app).toContain("<AresView");
    expect(app).not.toContain("CalendarView");
  });
});
