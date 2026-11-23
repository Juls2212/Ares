# Failure taxonomies and the shared kits

## Failure taxonomies

A failure taxonomy is a closed list of codes, each with one fixed Spanish message that contains no user data. The code is what logs, history and tests see; the message is what the person hears.

| Taxonomy | Where | Shape |
| --- | --- | --- |
| Messaging | `src/main/messaging/messaging-failures.ts` | code → message table built with `defineFailureTaxonomy` (17 codes) |
| Spotify | `src/main/spotify/spotify-failures.ts` | same factory (16 codes) |
| Files | `src/main/files/supervised-file-failures.ts` | same factory (13 codes); `filesFailure` stays local because a failure may carry partial counts |
| Weather | `src/main/weather/weather-service.ts` | same factory (6 codes) behind the `WEATHER_ERROR_CODES` name list |
| Catalog registration | `src/main/applications/catalog-registration-failures.ts` | local: a category maps to a `{ code, userMessage }` pair whose code differs from the category |
| Planner, applications, file validation, history, policy | `src/shared/*-contracts.ts` plus private message tables in the services | local: a name → code constant shared across many call sites, and a `Record<Code, string>` table per layer |

The "local" ones are not on the factory because they key their messages by the values of a shared name → code constant (used in many files) and return the domain-wide `OperationResult` shape, so moving them would change exported names for no safety gain. They are still exhaustive through `Record<Code, string>`.

## The kits

All four live in `src/shared` and are used by Main (the renderer does not need them yet).

- **`text-fold.ts`**: every way the code folds user text, each with its own name because they are not interchangeable: `foldForAlias` (accents, case, punctuation to spaces), `foldCaseAndDiacritics` (keeps punctuation and spacing), `foldSpanishWord`, `foldLooseText`, `foldAccentsOneToOne` (keeps ñ and string length), `lowerTrim`, `foldEventTitle`, plus the quote trimmers. Decomposing folds turn ñ into n and ü into u. A guard test fails if folding appears outside this file. `tests/text-fold.test.ts` shows where two variants differ.
- **`phrase-kit.ts`**: the "por favor" prefixes the phrase parsers share, `createPhraseMatcher` (anchored whole-string matcher compiled once from a phrase list) and `createPhraseSet` (folded membership). Phrase data stays in plain arrays in the module that owns it.
- **`failure-taxonomy.ts`**: `defineFailureTaxonomy(table)` derives the code type, an own-property guard (`isCode`, so "constructor" or "__proto__" are never codes), `messageFor`, and the failure and success result shapes from one const table.
- **`outcome-kit.ts`**: `outcomeIdentity`, `succeededOutcome`, `failedOutcome`, `cancelledOutcome`, `historySentences` (the generic history sentence per status) and `clarificationInterpretation`. Executors and the orchestrator use them instead of building outcomes by hand.

Lookups keyed by what the person said use `Object.hasOwn` (or a `Map`), never `in` or plain indexing, so a prototype member name cannot be a match.

Speech failures from ElevenLabs are a closed taxonomy too (`ELEVENLABS_FAILURES` in `src/main/voice/elevenlabs-speech-provider.ts`: `ELEVENLABS_NOT_CONFIGURED`, `_UNAUTHORIZED`, `_QUOTA_EXCEEDED`, `_VOICE_NOT_FOUND`, `_UNAVAILABLE`, `_TIMEOUT`, `_RESPONSE_INVALID`). They are only logged as codes before falling back to OpenAI speech.

## How to add a failure code

1. Add the code and its Spanish message to the taxonomy's table. The code type and the lookup follow automatically; there is no second table to update.
2. If the code means the system failed rather than the request being invalid, add it to the domain's `*_EXECUTION_FAILURE_CODES` list so the outcome status is `EXECUTION_FAILED`.
3. Keep the message a fixed sentence: no interpolation, no digits of four or more (unless fixed by design and allowlisted with a reason in `tests/failure-taxonomy.test.ts`), no path or URL.
4. Update `tests/golden/failure-outcome-golden.json` deliberately (`ARES_GOLDEN_WRITE=1`) and review the diff.

## How to add a capability

1. Add the action name to `ACTION_NAMES` and its input/proposal/submission types in `src/shared/action-contracts.ts`.
2. Add a policy record in `action-policy.ts` and an entry in `capability-registry.ts` (domain, approval class, label). The registry decides whether it is enabled at all.
3. Add a closed validator in the orchestrator (and the interpreter case, with a strict-schema field in `openai-structured-provider.ts` if the model proposes it) and route it in `action-executor.ts` to the domain executor.
4. Build outcomes with the outcome kit and failures from a taxonomy; add a generic history sentence in the orchestrator for the new domain if it has one.
5. Add the Spanish label in `src/renderer/app/app-state.ts`.
6. Update the snapshots deliberately: `action-catalog-snapshot`, `capability-completeness` (every enabled action must reach an executor and return a well-formed outcome), the provider-schema test, and the capability table in [CAPABILITIES.md](CAPABILITIES.md) (a docs-drift test fails until it matches).
7. If it makes a network request, put it in one module and update `call-site-allowlist.test.ts` with a purpose that says why.
