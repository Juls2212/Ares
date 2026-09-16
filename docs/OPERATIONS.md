# Operational Rules

## Environment and credentials

During development, secrets are supplied through environment variables. No actual secret appears in examples, configuration templates, Git, logs, or `window.ares`. OpenAI credentials remain in Main; database credentials never enter renderer or preload. Production may evaluate Electron `safeStorage` for user-provided OpenAI credentials; the final production flow is deferred and does not block Phase 1.

## Localization, dates, and time

Technical logs, error codes, contracts, and implementation identifiers are English. User-facing labels, confirmation summaries, notifications, errors, transcription interaction, and spoken responses are Spanish. Dates and times display in the local system zone. Exact instants are stored in UTC; date-only values preserve local calendar meaning. Relative Spanish phrases are resolved with current local date and time, then shown as a resolved value or clarified when materially ambiguous.

## Notifications

Electron Main owns scheduling and delivery of reminders, upcoming events, and eligible task notifications. Notification recovery after the application is closed is an open packaging decision. Unavailable notification capability returns a typed failure and Spanish explanation; it must not be silently ignored.

## Bidirectional voice interaction

```text
Manual push-to-talk
-> renderer browser permission and bounded command capture
-> narrow validated audio payload to Main

or

Opt-in wake-word mode while the Ares process is running
-> local detector waits only for the configured phrase
-> local activation event
-> bounded command capture
-> narrow validated audio payload to Main

then

Main-owned Speech-to-Text provider request
-> Spanish transcript
-> typed-input interpretation pipeline
-> structured actions and validation
-> visible confirmation when required
-> approved execution
-> visible Spanish response
-> optional Spanish Text-to-Speech response
```

Manual push-to-talk remains available. Wake-word mode is disabled by default and requires explicit Settings activation and explicit microphone permission. While Ares is running, including when its window is minimized, the detector waits locally only for the configured activation phrase. Waiting-mode audio is not persisted, is not sent to OpenAI or another provider, and must not be present in technical logs. Ares does not listen when its process is completely closed, and automatic launch when Windows starts is not approved.

The renderer uses constrained browser media APIs and has no privileged filesystem, process, shell, environment, or Electron capability. Main receives only a validated narrow command-audio payload after manual capture or local activation and owns the provider credentials and request. If detector state is uncertain, it fails closed: remote capture does not begin. The Spanish transcript then enters `assistant.interpret`, exactly like typed input. OpenAI is the planned provider for interpretation, Speech-to-Text, and Text-to-Speech, while exact model identifiers remain deferred because availability can change. Text-to-Speech is produced by a narrow Main-owned provider service and played through controlled renderer media using returned audio data or a later-approved narrow mechanism.

The user-facing voice state must visibly distinguish the following states: wake-word disabled (**“Modo de palabra de activación desactivado.”**), local waiting (**“Esperando la palabra de activación.”**), command recording (**“Escuchando tu instrucción.”**), processing (**“Procesando tu instrucción.”**), speaking (**“Ares está respondiendo.”**), and unavailable microphone or denied permission (**“No se puede usar el micrófono. Revisa los permisos.”**). A visible and audible activation acknowledgement occurs only after local detection. The user has an immediate mute or disable control.

Each activation creates at most one command-recording session. That session has inactivity and maximum-duration timeouts, and Ares returns to local waiting after completion, cancellation, timeout, or a controlled failure. Mute stops both local detection and command capture. Microphone loss returns a controlled unavailable state; re-entry to waiting requires a valid enabled preference and available permission/device. Wake-word detection only starts command capture. It never confirms an action. Voice uses the same action, risk, and confirmation system as typed input, and Level 2 confirmation remains a visible UI control correlated to the exact proposal. Ares may read a confirmation request aloud, but spoken confirmation is not MVP-required. Settings will allow spoken output to be enabled or disabled.

Temporary command audio is removed after processing. Short-lived diagnostic retention is allowed only after a technical failure when explicitly authorized by development configuration. Waiting-mode audio is never retained. Technical logs must never contain captured audio or unintended transcripts. Missing microphone permission, unavailable audio device, transcription failure, or unavailable provider returns a typed failure and a Spanish user-facing explanation.

## Logging, errors, and partial results

Every asynchronous operation returns a typed success or failure result. Batch work returns per-item outcomes; multi-action work returns ordered per-action outcomes. Technical logs use English stable codes, omit secrets, and avoid unnecessary personal file content. Raw exceptions are not user-facing. PostgreSQL, OpenAI, filesystem permissions, microphone access, and notifications each have controlled unavailable states rather than silent failure.

For file and database work, failure in one independent action can yield partial success; no global transaction is claimed across operating-system and database actions.
