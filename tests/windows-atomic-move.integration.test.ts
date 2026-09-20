import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWindowsAtomicMove } from "../src/main/files/windows-atomic-move";

const binaryPath = path.resolve(
  process.cwd(),
  "native/atomic-no-replace/build/Release/ares_atomic_no_replace.node"
);
const canRunNativeIntegration = process.platform === "win32" && existsSync(binaryPath);

describe.skipIf(!canRunNativeIntegration)("Windows atomic no-replace native bridge", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  const createTemporaryDirectory = async (): Promise<string> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ares-atomic-move-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  const move = createWindowsAtomicMove({
    isPackaged: () => false,
    getCurrentWorkingDirectory: () => process.cwd()
  });

  it("renames a file and a directory and moves a file on the same volume", async () => {
    const directory = await createTemporaryDirectory();
    const sourceFile = path.join(directory, "source.txt");
    const renamedFile = path.join(directory, "renamed.txt");
    const sourceDirectory = path.join(directory, "source-directory");
    const renamedDirectory = path.join(directory, "renamed-directory");
    const destinationDirectory = path.join(directory, "destination");
    const movedFile = path.join(destinationDirectory, "renamed.txt");
    await writeFile(sourceFile, "source", "utf8");
    await mkdir(sourceDirectory);
    await mkdir(destinationDirectory);

    expect(move.moveNoReplace(sourceFile, renamedFile)).toEqual({ ok: true });
    expect(move.moveNoReplace(sourceDirectory, renamedDirectory)).toEqual({ ok: true });
    expect(move.moveNoReplace(renamedFile, movedFile)).toEqual({ ok: true });
    await expect(access(movedFile)).resolves.toBeUndefined();
    await expect(access(renamedDirectory)).resolves.toBeUndefined();
  });

  it("rejects an existing destination without replacing it or moving the source", async () => {
    const directory = await createTemporaryDirectory();
    const sourceFile = path.join(directory, "source.txt");
    const destinationFile = path.join(directory, "destination.txt");
    await writeFile(sourceFile, "source", "utf8");
    await writeFile(destinationFile, "destination", "utf8");

    expect(move.moveNoReplace(sourceFile, destinationFile)).toEqual({ ok: false, reason: "COLLISION" });
    await expect(readFile(sourceFile, "utf8")).resolves.toBe("source");
    await expect(readFile(destinationFile, "utf8")).resolves.toBe("destination");
  });
});
