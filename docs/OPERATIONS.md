# Operational Rules

## Environment and credentials

During development, secrets are supplied through environment variables. No actual secret appears in examples, configuration templates, Git, logs, or `window.ares`. OpenAI credentials remain in Main; database credentials never enter renderer or preload. Production may evaluate Electron `safeStorage` for user-provided OpenAI credentials; the final production flow is deferred and does not block Phase 1.

## Localization, dates, and time

Technical logs, error codes, contracts, and implementation identifiers are English. User-facing labels, confirmation summaries, notifications, errors, transcription interaction, and spoken responses are Spanish. Dates and times display in the local system zone. Exact instants are stored in UTC; date-only values preserve local calendar meaning. Relative Spanish phrases are resolved with current local date and time, then shown as a resolved value or clarified when materially ambiguous.

## Notifications

Electron Main owns scheduling and delivery of reminders, upcoming events, and eligible task notifications. Notification recovery after the application is closed is an open packaging decision. Unavailable notification capability returns a typed failure and Spanish explanation; it must not be silently ignored.

## Bidirectional voice interaction

```text
User presses microphone
-> renderer browser permission and constrained audio capture
-> narrow validated audio payload to Main
-> Main-owned Speech-to-Text provider request
-> Spanish transcript
-> typed-input interpretation pipeline
-> structured actions and validation
-> visible confirmation when required
-> approved execution
-> visible Spanish response
-> optional Spanish Text-to-Speech response
```

The renderer captures audio only through constrained browser media APIs after the user explicitly presses the microphone control; it has no privileged filesystem, process, shell, environment, or Electron capability. Main receives only a validated narrow audio payload and owns the provider credentials and request. The Spanish transcript then enters `assistant.interpret`, exactly like typed input. OpenAI is the planned provider for interpretation, Speech-to-Text, and Text-to-Speech, while exact model identifiers remain deferred because availability can change. Text-to-Speech is produced by a narrow Main-owned provider service and played through controlled renderer media using returned audio data or a later-approved narrow mechanism. There is no wake word or permanent listening. Voice uses the same action, risk, and confirmation system as typed input. Level 2 confirmation is a visible UI control correlated to the exact proposal; Ares may read it aloud, but spoken confirmation is not MVP-required. Settings will allow spoken output to be enabled or disabled.

Temporary audio is removed after processing. Short-lived diagnostic retention is allowed only after a technical failure when explicitly authorized by development configuration. Missing microphone permission, unavailable audio device, transcription failure, or unavailable provider returns a typed failure and a Spanish user-facing explanation.

## Logging, errors, and partial results

Every asynchronous operation returns a typed success or failure result. Batch work returns per-item outcomes; multi-action work returns ordered per-action outcomes. Technical logs use English stable codes, omit secrets, and avoid unnecessary personal file content. Raw exceptions are not user-facing. PostgreSQL, OpenAI, filesystem permissions, microphone access, and notifications each have controlled unavailable states rather than silent failure.

For file and database work, failure in one independent action can yield partial success; no global transaction is claimed across operating-system and database actions.
