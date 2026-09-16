# Test Strategy

## Test levels

| Level | Scope |
| --- | --- |
| Unit | Pure action validation, date resolution, risk policy, `OperationResult<T>` and `ActionResult` mapping, planner rules, application alias resolution, and Spanish message selection. |
| Service integration | Main services with controlled database, filesystem, AI-provider, voice-provider, notification adapters, lifecycle state transitions, and confirmation correlation. |
| IPC contract | Preload-to-Main channel allowlists, request validation, separate query/action result mapping, event subscription cleanup, and prohibited-capability checks. |
| End-to-end later | Approved Electron flows through the temporary and then approved frontend. |

## Required boundaries

- Database tests use isolated PostgreSQL instances or schemas through the approved migration workflow; they never rely on manually altered schemas.
- Filesystem tests use temporary test directories only. They cover authorization, normalization, collisions, previews, inaccessible paths, and per-item partial outcomes.
- Application-launch tests assert registered-path validation and adapter calls; they do not open arbitrary programs in automated tests.
- AI tests use fixtures or mocked providers to test structured-output validation, unsupported actions, ambiguity clarification, dependencies, and containment.
- Voice tests use fixtures or mocked providers for constrained renderer capture boundaries, validated audio transfer, Spanish transcription handoff into `assistant.interpret`, optional Spanish speech output, cleanup of temporary audio, and no confirmation bypass.
- Security tests verify renderer isolation, absent general Node/Electron APIs, IPC allowlisting, secret redaction, path controls, confirmation identifier correlation, replay protection, and rejection of arbitrary commands.
- Spanish user-facing message tests verify that technical error codes do not surface as raw English errors.

## Phase 0 acceptance criteria

- The required documentation exists, is internally consistent, and contains no implementation artifacts.
- Every MVP action has a contract, risk policy, confirmation rule, result behavior, Spanish summary, and history behavior.
- Destructive file behavior is excluded; AI containment and both voice directions are documented.
- No unsupported backend, frontend, or architectural technology is introduced.

## Phase 1 acceptance criteria

- Electron starts with secure renderer/preload/Main separation and a temporary renderer only.
- Renderer cannot access Node.js, OS APIs, secrets, database, or unrestricted Electron APIs.
- Planned IPC contracts can be exercised with typed, controlled test stubs; no later-phase feature is implemented.
- No definitive UI decision, planner implementation, database schema, AI integration, voice integration, file operation, or application launch is added.

## Gate before definitive frontend

Frontend development begins only after backend services and IPC contracts are implemented, backend behavior is tested and stable, visual models are supplied by the user, and the corresponding design is explicitly approved.
