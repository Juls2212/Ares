import { describe, expect, it, vi } from "vitest";
import { createWindowsAtomicMove } from "../src/main/files/windows-atomic-move";

describe("Windows atomic move wrapper", () => {
  it("loads the development bridge lazily and maps a successful native result", () => {
    let loadCount = 0;
    let requestedPath: string | undefined;
    const loadBinding = (binaryPath: string) => {
      loadCount += 1;
      requestedPath = binaryPath;
      return { moveNoReplace: vi.fn(() => ({ succeeded: true, errorCode: 0 })) };
    };
    const move = createWindowsAtomicMove({
      isPackaged: () => false,
      getCurrentWorkingDirectory: () => "C:\\Ares",
      loadBinding,
      logError: vi.fn()
    });

    expect(loadCount).toBe(0);
    expect(move.moveNoReplace("C:\\Ares\\source.txt", "C:\\Ares\\target.txt")).toEqual({ ok: true });
    expect(loadCount).toBe(1);
    expect(requestedPath).toBe(
      "C:\\Ares\\native\\atomic-no-replace\\build\\Release\\ares_atomic_no_replace.node"
    );
    expect(move.moveNoReplace("C:\\Ares\\one.txt", "C:\\Ares\\two.txt")).toEqual({ ok: true });
    expect(loadCount).toBe(1);
  });

  it("loads the packaged bridge from Electron resources", () => {
    let requestedPath: string | undefined;
    const loadBinding = (binaryPath: string) => {
      requestedPath = binaryPath;
      return { moveNoReplace: vi.fn(() => ({ succeeded: true, errorCode: 0 })) };
    };
    const move = createWindowsAtomicMove({
      isPackaged: () => true,
      getPackagedResourcesPath: () => "C:\\Ares\\resources",
      loadBinding,
      logError: vi.fn()
    });

    expect(move.moveNoReplace("C:\\source.txt", "C:\\target.txt")).toEqual({ ok: true });
    expect(requestedPath).toBe("C:\\Ares\\resources\\ares_atomic_no_replace.node");
  });

  it.each([
    [80, "COLLISION"],
    [183, "COLLISION"],
    [17, "CROSS_VOLUME"],
    [2, "SOURCE_NOT_FOUND"],
    [3, "SOURCE_NOT_FOUND"],
    [5, "FAILED"]
  ] as const)("maps Windows error %i to the controlled %s result", (errorCode, reason) => {
    const move = createWindowsAtomicMove({
      isPackaged: () => false,
      getCurrentWorkingDirectory: () => "C:\\Ares",
      loadBinding: () => ({ moveNoReplace: () => ({ succeeded: false, errorCode }) }),
      logError: vi.fn()
    });

    expect(move.moveNoReplace("C:\\source.txt", "C:\\target.txt")).toEqual({ ok: false, reason });
  });

  it("returns unavailable without exposing a native loader error", () => {
    const logError = vi.fn();
    const move = createWindowsAtomicMove({
      isPackaged: () => false,
      getCurrentWorkingDirectory: () => "C:\\Ares",
      loadBinding: () => {
        throw new Error("C:\\private\\ares_atomic_no_replace.node could not load");
      },
      logError
    });

    const result = move.moveNoReplace("C:\\source.txt", "C:\\target.txt");
    expect(result).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(logError).toHaveBeenCalledWith("Windows atomic move binding could not be loaded.");
  });
});
