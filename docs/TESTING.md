# Testing strategy

Tests are Vitest files in `tests/`. They run offline with mocked Electron, filesystem, network and provider dependencies.

## Running them

```text
npm run typecheck      # tsc --noEmit over src and tests
npm test               # vitest run, excluding manual-tests
npm run test:db        # the *.integration.ts files, which need the development database
```

`npm run test:assistant:live` and the files in `manual-tests/` make real provider requests and are never part of `npm test`.

## What the suite protects

| Kind | Tests | What it pins |
| --- | --- | --- |
| Golden tables | `text-matching-golden`, `failure-outcome-golden` (data in `tests/golden/`) | What every folding function and phrase matcher accepts and rejects over a shared corpus; every failure message byte for byte; builder shapes; the history sentence of each domain and status. Re-record only deliberately with `ARES_GOLDEN_WRITE=1` and review the diff. |
| Kit unit tests | `text-fold`, `failure-taxonomy` | Each kit against a frozen copy of the code it replaced, idempotence, own-property guards, no backtracking on 10,000 characters, compile-time exhaustiveness, a guard against new ad-hoc folding, and a privacy walk over every failure taxonomy. |
| Snapshots | `action-catalog-snapshot`, `preload-surface-snapshot`, `ipc-channel-registry` | The exact action catalog (name, domain, approval, executor), the exact 14 preload methods and channels, and that each channel is registered once in Main and used by one preload method. |
| Completeness | `capability-completeness` | Every enabled action reaches its executor and returns a well-formed outcome (`KNOWN_GAPS` is empty and any new gap fails). |
| Allowlist | `call-site-allowlist`, `window-security-options` | Which files may use shell, child process, `fetch`, `safeStorage`, `process.env`, `new BrowserWindow`; the window security options. |
| Privacy | `history-privacy-domains` and the per-domain action tests | What history, logs and speech contain for each domain, including computer information. |
| Local mode | `local-intent-interpreter`, `system-info`, `command-input`, `system-voice` | The offline brain (over a hundred phrases with accents, typos, ambiguity, hostile and very long input, a "must go to the cloud" list, identical result shapes, `LOCAL_FIRST_ENABLED` and the key-missing fallback), computer information (validator, rounding, advice thresholds, no identifiers, history), the typed input and the key-missing messages, and the system voice with a mocked `speechSynthesis`. |
| Isolation and inventory | `legacy-isolation`, `removed-features-inventory`, `renderer-inventory` | The legacy-path tracker (now empty), that removed code and action names stay gone, which renderer files exist. |
| Documentation | `docs-drift` | The capability table (names, domains, approval classes), the stated action count, the migration list and the IPC channel table in `docs/` match the code, `drizzle/` and `IPC_CHANNELS`. |
| Behavior | the remaining files | Interpreter, orchestrator, executors, services, validators, renderer components and so on, with mocked dependencies. |

## Adding a test

New phrase matchers get golden rows in `text-matching-golden`. New failure codes get a golden row and pass the privacy walk. New capabilities update the snapshot, completeness and provider-schema tests.

## Not covered

- There is no end-to-end or manual test of the packaged app: no test launches Electron, drives the window, records a real microphone, shows a real notification, opens a real browser or WhatsApp, or plays audio.
- Real OpenAI and Spotify behavior is not tested; providers are mocked.
- Local mode has no listening or visual check: the system voice is tested with a mocked `speechSynthesis`, not with an installed Windows voice, and the typed input is tested through its markup, helpers and source wiring, not in a running window.
- Bundling of the Main and Preload entries needs Electron Forge (`npm run package` or `npm start`); the standalone Vite configs for those two cannot build without it. Only the renderer bundle can be built on its own.
- The `*.integration.ts` files need a live PostgreSQL and are not part of `npm test`; migrations are checked offline only for their SQL, snapshot and journal consistency.
- Visual design (the orb drawing, both themes, the title bar overlay) and the tray, including its theme submenu, have no visual check: the orb is tested with a recording fake 2D context, the contrast with pure functions and the tray with fakes.
