# Ares overview

Ares is a supervised, voice-first Windows desktop assistant built with Electron. The window is a single compact orb: the person speaks (or types), Ares interprets the request into typed action drafts, Main validates them, asks for confirmation when the action needs it, executes through fixed services and answers in short Spanish.

This document describes the code as it is. Anything that cannot be confirmed from the source or the automated tests is listed under "Not covered" in [TESTING.md](TESTING.md).

## What Ares does today

The catalog has **43 enabled actions** in seven domains (see [CAPABILITIES.md](CAPABILITIES.md) for every action and its approval class).

| Domain | What it does | Notes |
| --- | --- | --- |
| Planner (`INTERNAL_MEMORY`) | Create, update, complete and delete tasks; create, update and delete events; create reminders; read today's or the week's schedule; read the date and time. | A backend only: there is no planner screen. Reminders and event starts are delivered as Electron notifications by a Main scheduler while Ares is running. |
| Applications | Open a registered application, search inside the Spotify app, register an approved catalog application or one of the person's own executables. | Own executables are chosen in a native picker, never typed. |
| Web | Open one of three approved sites (Google, YouTube, Spotify) or run a search on them. | Main builds the URL from a closed list of origins. |
| Files (supervised) | Search the six known folders, reveal or open a result, create a folder, rename, move or organize results, send one result to the Recycle Bin. | Results are addressed by ordinal ("the second"), never by path. |
| Messaging | Save and delete contacts, prepare and edit a local message draft, open a WhatsApp chat with the draft after a confirmed review. | Ares never sends a message; the person presses send in WhatsApp. |
| Music | Connect a Spotify account, read the connection, play, pause, resume, skip, set the volume, say what is playing. | Spotify Web API with PKCE; playback state and playback control scopes only. |
| Weather | Answer the current weather or a forecast of up to six days ahead for a named place. | Read-only; the default place is Pasto, Colombia. |

Voice: push-to-talk recording is transcribed in Main (OpenAI transcription), the interpretation is requested from OpenAI in Main, and responses can be spoken with OpenAI speech. A global shortcut and a tray icon (open, quit) are managed by Main.

## What Ares does not do

- It does not execute anything the interpreter proposes without Main validating it against the capability registry.
- It does not run arbitrary commands, open arbitrary URLs or paths, delete files permanently, overwrite files, or send messages.
- It has no planner, calendar, habit, weekly-schedule or dashboard screen; habits and weekly schedules were removed entirely.

## Where to read next

- [ARCHITECTURE.md](ARCHITECTURE.md): layers, folders and the 13 IPC channels.
- [CAPABILITIES.md](CAPABILITIES.md): registry, approval classes, confirmation tokens, the full action list.
- [SECURITY.md](SECURITY.md): security baseline and privacy rules.
- [KITS.md](KITS.md): failure taxonomies and shared kits, and how to add a capability or failure code.
- [TESTING.md](TESTING.md): test strategy and what is not covered.
- [SETUP.md](SETUP.md): environment, database and migrations.
