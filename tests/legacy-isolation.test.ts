import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALREADY_ABSENT, LEGACY_ENTRIES, LEGACY_PATHS } from "./helpers/legacy-paths";
import { readSource } from "./helpers/read-source";

/**
 * Keeps current-behavior tests decoupled from code scheduled for deletion. A test that imports, reads or names a
 * LEGACY_PATHS entry must carry LEGACY_TEST_MARKER, and a test that carries no marker must not reference one.
 */

const testFiles = (directory: string): string[] =>
  readdirSync(path.resolve(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "helpers" ? [] : testFiles(relative);
    return /\.(ts|tsx)$/u.test(entry.name) ? [relative] : [];
  });

const files = testFiles("tests").filter((file) => file !== "tests/legacy-isolation.test.ts").sort();

const inEntry = (target: string, entry: string): boolean => target === entry || target.startsWith(`${entry}/`);

/** Repo-relative targets a test refers to: resolved relative imports plus quoted src/ or native/ paths. */
const referencedTargets = (file: string): string[] => {
  const text = readSource(file);
  const targets = new Set<string>();
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/gu)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!));
    for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`]) {
      if (existsSync(path.resolve(process.cwd(), candidate))) { targets.add(candidate); break; }
    }
    targets.add(resolved);
  }
  for (const match of text.matchAll(/["'`]((?:src|native)\/[A-Za-z0-9_\-./]+)["'`]/gu)) targets.add(match[1]!);
  return [...targets];
};

const legacyReferences = (file: string): string[] =>
  [...new Set(referencedTargets(file).flatMap((target) => LEGACY_PATHS.filter((entry) => inEntry(target, entry))))];

const hasMarker = (file: string): boolean => readSource(file).includes("LEGACY_TEST_MARKER");

/**
 * Marked tests that reach legacy behavior only through surviving modules, so they reference no legacy path directly.
 * Empty since Phase 3.1 removed the weekly and habit parts of the planner code.
 */
const MARKED_WITHOUT_DIRECT_PATH: readonly string[] = [];

describe("legacy isolation", () => {
  it("tracks no legacy path any more: every cleanup phase is done", () => {
    expect(LEGACY_PATHS).toEqual([]);
  });

  it("lists every legacy path with a phase and a note, and every entry still exists", () => {
    for (const entry of LEGACY_ENTRIES) {
      expect(entry.phase.length, entry.path).toBeGreaterThan(0);
      expect(entry.note.length, entry.path).toBeGreaterThan(10);
      const absentReason = ALREADY_ABSENT[entry.path];
      if (absentReason !== undefined) {
        expect(absentReason.length, `${entry.path} needs a reason`).toBeGreaterThan(10);
        expect(existsSync(path.resolve(process.cwd(), entry.path)), `${entry.path} is listed as absent`).toBe(false);
      } else {
        expect(existsSync(path.resolve(process.cwd(), entry.path)), `${entry.path} does not exist`).toBe(true);
      }
    }
    expect(new Set(LEGACY_PATHS).size).toBe(LEGACY_PATHS.length);
  });

  it("never lists anything the decisions keep", () => {
    for (const kept of [
      "src/main/planner",
      "src/main/actions/planner-action-executor.ts",
      "src/main/reminders",
      "src/main/events",
      "src/main/weather",
      "src/main/actions/weather-action-executor.ts",
      "src/main/applications/custom-application-registration-service.ts",
      "src/main/applications/catalog-application-registration.ts",
      "src/main/files/supervised-file-service.ts",
      "src/main/messaging",
      "src/main/spotify",
      "src/shared/planner-contracts.ts"
    ]) {
      expect(LEGACY_PATHS.filter((entry) => inEntry(kept, entry) || inEntry(entry, kept)), kept).toEqual([]);
    }
  });

  it("marks every test that references a legacy path (rule i)", () => {
    const unmarked = files.filter((file) => legacyReferences(file).length > 0 && !hasMarker(file));
    expect(unmarked).toEqual([]);
  });

  it("keeps every unmarked test free of legacy references (rule ii)", () => {
    const offenders = files.filter((file) => !hasMarker(file)).flatMap((file) => legacyReferences(file).map((entry) => `${file} -> ${entry}`));
    expect(offenders).toEqual([]);
  });

  it("gives every marked test the LEGACY comment, and marks nothing that has no legacy reason", () => {
    for (const file of files.filter(hasMarker)) {
      expect(readSource(file), file).toContain("LEGACY: scheduled for deletion in Refactor Phase");
      if (!MARKED_WITHOUT_DIRECT_PATH.includes(file)) expect(legacyReferences(file).length, `${file} is marked but references no legacy path`).toBeGreaterThan(0);
    }
    for (const file of MARKED_WITHOUT_DIRECT_PATH) expect(hasMarker(file), file).toBe(true);
  });

  it("keeps the helpers and this file out of the scan so the marker rule cannot be bypassed by moving a reference there", () => {
    expect(files.some((file) => file.startsWith("tests/helpers/"))).toBe(false);
    expect(files.length).toBeGreaterThan(100);
  });
});
