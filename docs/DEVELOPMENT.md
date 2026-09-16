# Development Database Setup

## Scope

This document describes the PostgreSQL development container only. It is not the final Windows production provisioning strategy. Drizzle, database schemas, migrations, application roles, and Electron Main database access are not configured yet.

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

`db:up` starts only PostgreSQL in detached mode. `db:status` reports the Compose health status; wait for `healthy` before later database work. `db:logs` follows PostgreSQL logs. `db:down` stops the Compose project without deleting `ares_postgres_data`.

## Credentials and future work

The initial PostgreSQL user is a local-development bootstrap user and may be used for future migrations during development. It is not the final production credential model. Least-privilege application roles may be refined before production packaging, whose Windows provisioning strategy remains an open decision.

The database URL is for a future Electron Main-owned connection only. It must never be exposed through `window.ares`, Vite variables, preload, or the renderer.
