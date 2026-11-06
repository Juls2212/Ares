import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string): string => readFileSync(file, "utf8");

describe("background operation wiring in the main process", () => {
  const main = source("src/main/main.ts");

  it("disables background throttling without changing the security options or the window frame", () => {
    expect(main).toContain("backgroundThrottling: false");
    for (const option of ["contextIsolation: true", "nodeIntegration: false", "sandbox: true", "webSecurity: true"]) {
      expect(main).toContain(option);
    }
    expect(main).not.toMatch(/frame:\s*false|alwaysOnTop|skipTaskbar/);
  });

  it("holds the single-instance lock, creates the tray before the window, and attaches close-to-tray", () => {
    expect(main).toContain("backgroundLifecycle.start()");
    expect(main).toContain("if (!isPrimaryInstance) app.quit()");
    expect(main).toContain("if (!isPrimaryInstance) return;");
    expect(main.indexOf("backgroundLifecycle.createTray()")).toBeLessThan(main.indexOf("await createMainWindow()"));
    expect(main).toContain("backgroundLifecycle.attachWindow(toManagedWindow(createdWindow))");
    expect(main).toContain("globalVoiceShortcutLifecycle.stop()");
  });

  it("never auto-starts, listens continuously, or captures audio in Main", () => {
    expect(main).not.toContain("setLoginItemSettings");
    for (const forbidden of ["getUserMedia", "MediaRecorder", "desktopCapturer", "wake", "continuous"]) {
      expect(main).not.toContain(forbidden);
    }
    expect(source("src/main/background/background-lifecycle.ts")).not.toMatch(/getUserMedia|MediaRecorder|setLoginItemSettings/);
  });

  it("does not add a renderer channel for background operation", () => {
    const preload = source("src/preload/preload.ts");
    expect(preload).not.toMatch(/tray|background|quit/i);
    expect(source("src/shared/contracts.ts")).not.toMatch(/tray|background/i);
  });

  it("are wired in the main process without touching close or security behavior", () => {
    const main = source("src/main/main.ts");
    expect(main).toContain("getShortcutLabel: () => {");
    expect(main).toContain("formatShortcutForDisplay(active)");
    expect(main).toContain("onChange: () => backgroundLifecycle.refreshTray()");
    expect(main).toContain("displayBalloon: (options) => tray.displayBalloon(options)");
    for (const option of ["contextIsolation: true", "nodeIntegration: false", "sandbox: true", "webSecurity: true", "backgroundThrottling: false"]) {
      expect(main).toContain(option);
    }
  });
});
