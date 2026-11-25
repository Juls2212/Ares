/** The only names that the user-level ares.env file may provide. Anything else in the file is ignored. */
export const ARES_ENV_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_TRANSCRIPTION_MODEL",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "SPOTIFY_CLIENT_ID",
  "DATABASE_URL"
] as const;

export type AresEnvName = (typeof ARES_ENV_NAMES)[number];

export const ARES_ENV_FILE_NAME = "ares.env";

/** A configuration file is a few lines; anything bigger is not read. */
export const ARES_ENV_MAX_BYTES = 64 * 1024;

const ALLOWED = new Set<string>(ARES_ENV_NAMES);
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u;

const unquote = (raw: string): string => {
  const first = raw[0];
  if ((first === '"' || first === "'") && raw.length >= 2) {
    const end = raw.indexOf(first, 1);
    if (end > 0) return raw.slice(1, end);
  }
  // Unquoted: a " #" starts a trailing comment.
  const comment = raw.search(/\s#/u);
  return (comment >= 0 ? raw.slice(0, comment) : raw).trim();
};

/**
 * Parses KEY=VALUE lines. Blank lines and lines starting with # are skipped, a value may be single or double
 * quoted, names outside ARES_ENV_NAMES are ignored and empty values are dropped. It never logs and never throws.
 */
export const parseAresEnv = (text: string): Partial<Record<AresEnvName, string>> => {
  const result: Partial<Record<AresEnvName, string>> = {};
  for (const line of text.replace(/^﻿/u, "").split(/\r?\n/u)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = LINE.exec(line);
    if (!match || !ALLOWED.has(match[1])) continue;
    const value = unquote(match[2]);
    if (value !== "") result[match[1] as AresEnvName] = value;
  }
  return result;
};
