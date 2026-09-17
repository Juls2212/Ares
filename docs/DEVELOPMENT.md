# Development Database Setup

## Scope

This document describes the PostgreSQL development container and Drizzle development tooling only. It is not the final Windows production provisioning strategy. The TypeScript MVP schema is defined, but migrations, application roles, and Electron Main runtime database access are not configured yet.

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

The database URL is read only by trusted Main configuration and Drizzle Kit tooling. It must never be exposed through `window.ares`, Vite variables, preload, or the renderer. Development tooling reads the root `.env`; the later packaged-production credential strategy remains open.

## Drizzle workflow

Drizzle ORM, the `pg` driver, and Drizzle Kit are configured for PostgreSQL. `drizzle.config.ts` uses the same `DATABASE_URL` as the future Main-owned database client, points to `src/main/database/schema/index.ts`, and will write generated, version-controlled migrations to `drizzle/`.

The definitive MVP schema is defined in `src/main/database/schema/`, but no migration has been generated or applied and no Ares application table exists yet. Do not run `db:migrate` until the initial migration has been reviewed and approved. Do not use `db:push` because the project uses version-controlled migrations rather than automatic schema push.

```powershell
npm run db:check
npm run db:generate
npm run db:migrate
npm run db:studio
```

`db:check` performs Drizzle Kit's non-mutating migration/configuration check. `db:generate` and `db:migrate` are intentionally prepared for later approved schema work and are not part of this setup validation. `db:studio` starts only when requested manually and is never started by Ares.
