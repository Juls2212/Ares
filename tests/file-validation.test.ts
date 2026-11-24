import { describe, expect, it } from "vitest";
import {
  isApprovedFileRoot,
  validateRootRelativePath,
  validateSafeFileReference
} from "../src/main/files/file-validation";

const expectFailureCode = (
  result: { ok: boolean; error?: { code: string } },
  code: string
): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error?.code).toBe(code);
};

describe("approved-root and root-relative path validation", () => {
  it("accepts only the three approved file roots", () => {
    for (const root of ["DOCUMENTS", "DOWNLOADS", "DESKTOP"]) expect(isApprovedFileRoot(root)).toBe(true);
    for (const root of ["SYSTEM", "documents", "", 1, null, undefined, {}]) expect(isApprovedFileRoot(root)).toBe(false);
  });

  it("accepts a closed root-id and relative-path reference and rejects anything else", () => {
    expect(validateSafeFileReference({ rootId: "DOCUMENTS", relativePath: "Proyectos\\2026" })).toEqual({
      ok: true,
      data: { rootId: "DOCUMENTS", relativePath: "Proyectos\\2026" }
    });
    expectFailureCode(validateSafeFileReference({ rootId: "SYSTEM", relativePath: "a" }), "FILE_ROOT_INVALID");
    expectFailureCode(validateSafeFileReference({ rootId: "DOCUMENTS", relativePath: "..\\a" }), "FILE_RELATIVE_PATH_INVALID");
    expectFailureCode(validateSafeFileReference({ rootId: "DOCUMENTS", relativePath: "a", extra: true }), "FILE_UNKNOWN_FIELD");
    expectFailureCode(validateSafeFileReference("DOCUMENTS"), "FILE_INPUT_INVALID");
    expectFailureCode(validateSafeFileReference([]), "FILE_INPUT_INVALID");
  });

  it.each([
    "C:\\Windows\\System32",
    "\\\\server\\share",
    "\\\\?\\C:\\Windows",
    "..\\outside",
    "folder\\..\\outside",
    "folder/child",
    "folder\\\\child",
    "file.txt:alternate-stream",
    "folder?name",
    "folder\u0000child",
    " folder"
  ])("rejects unsafe root-relative paths: %s", (relativePath) => {
    expectFailureCode(validateRootRelativePath(relativePath), "FILE_RELATIVE_PATH_INVALID");
  });
});
