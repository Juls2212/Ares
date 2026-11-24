import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { ENABLED_ASSISTANT_CAPABILITIES } from "../src/main/actions/capability-registry";
import { IPC_CHANNELS } from "../src/shared/contracts";
import { readSource } from "./helpers/read-source";

/**
 * Keeps the documentation from drifting from the code, offline: the capability table equals the enabled registry (names, domain
 * and approval class), the stated action count equals the catalog, the documented migrations equal the files in drizzle/, and
 * the documented IPC channels equal IPC_CHANNELS.
 */

const docs = (name: string): string => readSource(`docs/${name}`);

const flattenChannels = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Object.values(value as Record<string, unknown>).flatMap(flattenChannels);

const APPROVAL_LABEL = { DIRECT: "Direct", CONFIRMATION_REQUIRED: "Standard confirmation", REINFORCED_CONFIRMATION_REQUIRED: "Reinforced confirmation" } as const;

describe("documentation matches the code", () => {
  const capabilities = docs("CAPABILITIES.md");
  const rows = [...capabilities.matchAll(/^\| `([A-Z_]+)` \| ([A-Z_]+) \| ([A-Za-z ]+) \| (\d) \|/gmu)].map((match) => ({
    action: match[1]!, domain: match[2]!, approval: match[3]!.trim(), risk: Number(match[4])
  }));

  it("lists exactly the enabled capabilities, in registry order, with their domain and approval class", () => {
    expect(rows.map((row) => row.action)).toEqual(ENABLED_ASSISTANT_CAPABILITIES.map((entry) => entry.action));
    for (const entry of ENABLED_ASSISTANT_CAPABILITIES) {
      const row = rows.find((candidate) => candidate.action === entry.action)!;
      expect(row.domain, entry.action).toBe(entry.domain);
      expect(row.approval, entry.action).toBe(APPROVAL_LABEL[entry.approval]);
    }
  });

  it("states the same number of actions as the catalog, everywhere it states one", () => {
    const count = ENABLED_ASSISTANT_CAPABILITIES.length;
    expect(rows).toHaveLength(count);
    for (const file of ["CAPABILITIES.md", "OVERVIEW.md"]) {
      const stated = [...docs(file).matchAll(/\*\*(\d+) enabled actions\*\*/gu)].map((match) => Number(match[1]));
      expect(stated, file).toEqual([count]);
    }
  });

  it("names every domain the registry uses and no other", () => {
    const named = /Domains: (.+)\./u.exec(capabilities)?.[1]?.match(/`([A-Z_]+)`/gu)?.map((token) => token.replaceAll("`", ""));
    expect(named).toEqual([...new Set(ENABLED_ASSISTANT_CAPABILITIES.map((entry) => entry.domain))]);
  });

  it("documents exactly the migrations in drizzle/, in order", () => {
    const files = readdirSync(path.resolve(process.cwd(), "drizzle")).filter((name) => name.endsWith(".sql")).sort();
    const documented = [...docs("SETUP.md").matchAll(/^\| `(\d{4}_[a-z_]+\.sql)` \|/gmu)].map((match) => match[1]);
    expect(documented).toEqual(files);
  });

  it("states what the last migration does to data", () => {
    const setup = docs("SETUP.md");
    expect(setup).toContain("0009_remove_habits_and_weekly_schedules.sql");
    expect(setup).toMatch(/permanently deletes every row/u);
  });

  it("documents exactly the IPC channels in IPC_CHANNELS", () => {
    const documented = [...docs("ARCHITECTURE.md").matchAll(/^\| `[\w.]+`[^|]*\| `([a-z:-]+)` \|/gmu)].map((match) => match[1]).sort();
    expect(documented).toEqual(flattenChannels(IPC_CHANNELS).sort());
    expect(docs("ARCHITECTURE.md")).toContain(`The ${documented.length} IPC channels`);
  });

  it("does not describe removed features as current", () => {
    for (const file of readdirSync(path.resolve(process.cwd(), "docs")).filter((entry) => entry.endsWith(".md"))) {
      const text = readSource(`docs/${file}`);
      for (const removed of ["RENAME_FILE", "ORGANIZE_FILES", "OPEN_WEB_PAGE", "atomic-no-replace", "N-API", "Tailwind", "Planificador", "CREATE_HABIT", "WEEKLY_SCHEDULE"]) {
        expect(text, `${file} mentions ${removed}`).not.toContain(removed);
      }
    }
  });

  it("keeps the docs free of secrets and local absolute paths", () => {
    for (const file of readdirSync(path.resolve(process.cwd(), "docs")).filter((entry) => entry.endsWith(".md"))) {
      const text = readSource(`docs/${file}`);
      expect(text, file).not.toMatch(/[A-Za-z]:\\Users\\|sk-[A-Za-z0-9]{8,}|postgres(?:ql)?:\/\/\w+:\w+@/u);
    }
  });
});
