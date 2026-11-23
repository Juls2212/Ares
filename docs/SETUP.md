# Setup, database and migrations

Ares targets Windows. The database is PostgreSQL; development uses Docker Compose (`compose.yaml`, image `postgres:17.11-bookworm`, published only on `127.0.0.1`).

## Environment variables

Copy `.env.example` to `.env` and fill in the values. `.env` is not committed. Only the names are listed here.

| Name | Used by |
| --- | --- |
| `ARES_POSTGRES_DB`, `ARES_POSTGRES_USER`, `ARES_POSTGRES_PASSWORD`, `ARES_POSTGRES_PORT` | `compose.yaml`, the development database container |
| `DATABASE_URL` | Main's database client and `drizzle.config.ts` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Interpretation (Main only) |
| `OPENAI_TRANSCRIPTION_MODEL` | Speech-to-text (Main only); speech output also needs `OPENAI_API_KEY` |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Optional spoken voice (Main only). Both must be set to use ElevenLabs; otherwise, or if an ElevenLabs request fails, the OpenAI voice is used |
| `SPOTIFY_CLIENT_ID` | The public client id of the Spotify integration (read by Main; it is not listed in `.env.example`) |

None of them is exposed to Vite, the preload or the renderer.

### Optional ElevenLabs voice

Ares speaks with OpenAI by default. To use ElevenLabs, set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env`. Choose a voice in the ElevenLabs voice library that lists Spanish (filter by language) and copy its voice id; the model is the low-latency `eleven_flash_v2_5` with Spanish forced. The free tier has a small monthly character quota; when it runs out (or the key or voice is wrong, or the service is down) the same sentence is spoken by the OpenAI voice, so Ares is never silent. The log shows `Speech provider used [ELEVENLABS].` on success or `Speech provider fallback to OpenAI [CODE].` on fallback.

## Scripts

From `package.json`:

| Script | What it runs |
| --- | --- |
| `npm start`, `npm run package`, `npm run make` | Electron Forge |
| `npm run build` | `typecheck`, then `electron-forge package` |
| `npm run typecheck`, `npm test`, `npm run test:db` | see [TESTING.md](TESTING.md) |
| `npm run db:up`, `db:down`, `db:logs`, `db:status`, `db:config` | the Docker Compose service |
| `npm run db:generate`, `db:migrate`, `db:check`, `db:studio` | drizzle-kit against `DATABASE_URL` |

Typical first run: `npm run db:up`, then `npm run db:migrate`, then `npm run db:check`, then `npm start`.

## Migrations

Migrations live in `drizzle/` with their snapshots and journal in `drizzle/meta/`. Applied migrations are never edited; each change is a new, numbered file.

| Migration | Change |
| --- | --- |
| `0000_initial_schema.sql` | Initial schema: categories, tasks, events, reminders, applications and aliases, action history, settings. |
| `0001_event_notification_deliveries.sql` | Durable event-start delivery records. |
| `0002_weekly_routines.sql` | Weekly routines (since dropped by 0009). |
| `0003_weekly_schedules.sql` | Weekly schedules (since dropped by 0009). |
| `0004_habit_tracking.sql` | Habits and habit completions (since dropped by 0009). |
| `0005_habit_icons.sql` | Habit icons (since dropped by 0009). |
| `0006_application_catalog_targets.sql` | Catalog application targets and launch modes. |
| `0007_application_catalog_claude.sql` | Adds the `CLAUDE` catalog key. |
| `0008_messaging_contacts.sql` | Messaging contacts and aliases. |
| `0009_remove_habits_and_weekly_schedules.sql` | Drops `habit_completions`, `habits`, `weekly_routines`, `weekly_schedules` and the `habit_frequency` and `weekday` types. |

**Migration 0009 permanently deletes every row in the dropped tables.** The application no longer reads them, so it keeps working with the old tables still present if 0009 has not been applied yet. Run `npm run db:migrate` and `npm run db:check` yourself when you decide to apply it; nothing in the test suite applies migrations.

## Current tables

`action_history`, `application_aliases`, `applications`, `categories`, `event_notification_deliveries`, `events`, `messaging_contact_aliases`, `messaging_contacts`, `reminders`, `settings`, `tasks`. The Drizzle schema is `src/main/database/schema/`.
