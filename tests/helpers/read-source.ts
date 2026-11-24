import { readFileSync } from "node:fs";
import path from "node:path";

/** Shared marker for tests that only protect legacy code; they are found with a text search for this constant. */
export const LEGACY_TEST_MARKER = "LEGACY: scheduled for deletion in Refactor Phase 2";

/** Line endings differ between machines (LF in the repository, CRLF on Windows checkouts); tests compare LF only. */
export const normalizeLineEndings = (text: string): string => text.replace(/\r\n/gu, "\n");

/** Reads a repository file relative to the project root with line endings normalized to LF. */
export const readSource = (file: string): string =>
  normalizeLineEndings(readFileSync(path.resolve(process.cwd(), file), "utf8"));

/** Every .ts/.tsx file under a directory (repo-relative, forward slashes), skipping build output. */
export const listSourceFiles = (directory: string): string[] => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const walk = (current: string): string[] =>
    readdirSync(path.resolve(process.cwd(), current), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${current}/${entry.name}`;
      if (entry.isDirectory()) return ["node_modules", ".vite", "out"].includes(entry.name) ? [] : walk(relative);
      return /\.(ts|tsx)$/u.test(entry.name) ? [relative] : [];
    });
  return walk(directory).sort();
};
