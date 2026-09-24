# Development Database Setup

## Scope

This document describes the PostgreSQL development container and Drizzle development tooling only. It is not the final Windows production provisioning strategy. The TypeScript MVP schema and its initial migration are applied and verified in the development database. Electron Main owns the private runtime client; application roles remain a future production concern.

## Prerequisites

- Docker Desktop is installed and its Linux container engine is running.
- The repository root contains a local `.env` copied from `.env.example`.

Create the local environment file in PowerShell:

```powershell
Copy-Item .env.example .env
```

Replace `ARES_POSTGRES_PASSWORD` in `.env` with a local development password. Do not commit `.env`. If that password contains URL-special characters, percent-encode it in `DATABASE_URL`.

## Development service

The Compose project runs one official `postgres:17.11-bookworm` container. PostgreSQL major version 17 is supported through November 2029. The image is pinned to the current 17.11 minor release and does not use Alpine.

The service binds `127.0.0.1:${ARES_POSTGRES_PORT}` to PostgreSQL port `5432` inside the container. The default `.env.example` port is `5433`, which avoids a likely host PostgreSQL installation on `5432`. The database is not exposed to the local network.

The named `ares_postgres_data` volume stores the PostgreSQL data directory. `restart: unless-stopped` keeps the local development service available after a Docker restart while allowing `npm run db:down` to stop it intentionally. `db:down` does not remove the volume.

## Commands

```powershell
npm run db:config
npm run db:up
npm run db:status
npm run db:logs
npm run db:down
```

`db:config` validates and renders the Compose structure without interpolating secret values. `db:up` starts only PostgreSQL in detached mode. `db:status` reports the Compose health status; wait for `healthy` before later database work. `db:logs` follows PostgreSQL logs. `db:down` stops the Compose project without deleting `ares_postgres_data`.

## Credentials and future work

The initial PostgreSQL user is a local-development bootstrap user and may be used for future migrations during development. It is not the final production credential model. Least-privilege application roles may be refined before production packaging, whose Windows provisioning strategy remains an open decision.

The database URL is read only by trusted Main configuration and Drizzle Kit tooling. Electron Main owns the lazy `pg` connection pool and its typed Drizzle client, then closes the pool during application shutdown. It must never be exposed through `window.ares`, Vite variables, preload, or the renderer. Development tooling reads the root `.env`; the later packaged-production credential strategy remains open. Migrations remain manual development operations: Ares does not generate or apply them during startup.

## Local OpenAI interpretation configuration

The future explicit Main-only interpretation flow reads `OPENAI_API_KEY` and `OPENAI_MODEL` from the ignored local `.env`. Both values are required only when an interpretation is requested; neither has a production fallback and neither may use a `VITE_` name. Copy the blank placeholders from `.env.example`, keep the real values local, and never print, commit, bundle, or expose them through preload or the renderer. Tests, startup, packaging, and normal builds do not make OpenAI requests. The paid manual diagnostic is excluded from normal and CI test discovery; run it only deliberately with `$env:ARES_LIVE_ASSISTANT_CHECK='1'; npm run test:assistant:live` in PowerShell.

## Drizzle workflow

Drizzle ORM, the `pg` driver, and Drizzle Kit are configured for PostgreSQL. `drizzle.config.ts` uses the same `DATABASE_URL` as the future Main-owned database client, points to `src/main/database/schema/index.ts`, and will write generated, version-controlled migrations to `drizzle/`.

The definitive MVP schema is defined in `src/main/database/schema/`. Its initial migration, `drizzle/0000_initial_schema.sql`, has been generated, reviewed, and applied once to the development database. `db:generate` writes version-controlled migration artifacts only and does not modify PostgreSQL. Review generated SQL and Drizzle metadata before running `db:migrate`; apply only an approved migration. Drizzle records applied migrations and a repeated `db:migrate` run is expected to be idempotent. Do not use `db:push` because the project uses version-controlled migrations rather than automatic schema push.

```powershell
npm run db:check
npm run db:generate
npm run db:migrate
npm run db:studio
```

`db:check` performs Drizzle Kit's non-mutating migration/configuration check. `db:generate` creates migration files without connecting to or changing PostgreSQL. `db:migrate` applies approved migrations and must not run before their review. `db:studio` starts only when requested manually and is never started by Ares.

## Database integration tests

Run `npm run test:db` only after `npm run db:up` and `npm run db:status` report a healthy PostgreSQL service. This dedicated suite validates Main-only planner persistence against the local development database and cleans up every row it creates. It is intentionally separate from `npm test`, which never requires Docker or PostgreSQL.

Planner schedule tests use an injected local-calendar clock: today is the half-open local-day interval, and a week runs from Monday through Sunday. This keeps schedule boundaries deterministic and independent of the developer machine's locale in automated tests.

## Windows native no-replace bridge

The Main-only file-mutation service uses a small Windows N-API bridge for the final no-replace file or directory rename/move operation. It is not exposed through IPC, preload, or the renderer. The bridge requires MSVC x64 C++ tools, a Windows SDK, and Python 3. Run `npm run native:build` to compile it against the Electron version pinned by this project, and `npm run test:native` for its isolated temporary-directory tests. The build uses an ignored local Electron-header cache and does not copy a machine-specific binary into source control. Electron Forge packages the resulting `.node` file as a resource outside ASAR.
