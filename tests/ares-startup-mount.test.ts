import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

// Mount the real view in an isolated, hidden Electron renderer. This does not
// start Ares Main services, access a microphone, or contact a provider.
it.runIf(process.platform === "win32")("mounts Ares without audio APIs or automatic speech requests", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ares-startup-mount-"));
  try {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(), loader: "tsx",
        contents: `
          import React from "react";
          import { createRoot } from "react-dom/client";
          import { AresView } from "./src/renderer/views/ares-view";
          let requests = 0;
          window.Audio = undefined;
          window.MediaRecorder = undefined;
          window.ResizeObserver = undefined;
          URL.createObjectURL = undefined;
          URL.revokeObjectURL = undefined;
          window.ares = { speech: { speak: () => { requests++; throw new Error("Unexpected request"); } } };
          let failed = false;
          window.addEventListener("error", () => { failed = true; });
          const root = createRoot(document.getElementById("root"));
          const noop = () => {};
          root.render(<React.StrictMode><AresView automaticSpeech={false}
            onAutomaticSpeechChange={noop} technicalState="SUCCESS"
            voiceLabel="Listo para grabar" voiceState="IDLE" orbState="idle"
            instruction="" isInterpreting={false} draftStates={{}}
            onInstructionChange={noop} onInterpret={noop} onStartRecording={noop}
            onStopRecording={noop} onCancelRecording={noop} onPropose={noop}
            onResolveConfirmation={noop} /></React.StrictMode>);
          setTimeout(() => {
            const mounted = document.querySelector("h1")?.textContent === "Ares"
              && !!document.querySelector("textarea")
              && !!document.querySelector(".particle-orb__fallback")
              && document.body.textContent.includes("Interpretar");
            root.unmount();
            document.title = mounted && !failed && requests === 0 ? "MOUNT_PASS" : "MOUNT_FAIL";
          }, 300);
        `
      },
      bundle: true, write: false, platform: "browser", format: "iife",
      jsx: "automatic", logLevel: "silent"
    });
    const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-mount'; style-src 'unsafe-inline'"><div id="root"></div><script nonce="mount">${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>`;
    await writeFile(path.join(directory, "renderer.html"), html);
    await writeFile(path.join(directory, "runner.cjs"), `
      const { app, BrowserWindow } = require("electron");
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, webPreferences: {
          sandbox: true, contextIsolation: true, nodeIntegration: false
        }});
        const timer = setTimeout(() => { console.log("MOUNT_TIMEOUT"); app.exit(1); }, 10000);
        window.on("page-title-updated", (_event, title) => {
          if (title === "MOUNT_PASS" || title === "MOUNT_FAIL") {
            clearTimeout(timer); console.log(title); app.exit(title === "MOUNT_PASS" ? 0 : 1);
          }
        });
        await window.loadFile(${JSON.stringify(path.join(directory, "renderer.html"))});
      });
    `);
    const executable = createRequire(import.meta.url)("electron") as string;
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.OPENAI_API_KEY;
    delete environment.OPENAI_MODEL;
    delete environment.OPENAI_TRANSCRIPTION_MODEL;
    delete environment.DATABASE_URL;
    const result = await promisify(execFile)(executable, [path.join(directory, "runner.cjs")], {
      timeout: 15000, windowsHide: true, env: environment
    }).catch(() => { throw new Error("Isolated renderer mount failed"); });
    expect(result.stdout).toContain("MOUNT_PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
