import { describe, expect, it } from "vitest";
import {
  validateFileSearchInput,
  validateRootRelativePath
} from "../src/main/files/file-validation";

const expectFailureCode = <T>(
  result: { ok: boolean; error?: { code: string } },
  code: string
): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error?.code).toBe(code);
};

describe("file search validation", () => {
  it("accepts approved roots and normalizes only safe search filters", () => {
    expect(
      validateFileSearchInput({
        rootId: "DOCUMENTS",
        query: "  informe  ",
        extensions: [".PDF", "docx", "pdf"],
        relativePath: "Proyectos\\2026",
        limit: 25
      })
    ).toEqual({
      ok: true,
      data: {
        rootId: "DOCUMENTS",
        query: "informe",
        extensions: ["pdf", "docx"],
        relativePath: "Proyectos\\2026",
        limit: 25
      }
    });
  });

  it("rejects unknown roots, blank queries, malformed filters, and unsupported keys", () => {
    expectFailureCode(
      validateFileSearchInput({ rootId: "SYSTEM", query: "informe" }),
      "FILE_ROOT_INVALID"
    );
    expectFailureCode(
      validateFileSearchInput({ rootId: "DOCUMENTS", query: "   " }),
      "FILE_QUERY_INVALID"
    );
    expectFailureCode(
      validateFileSearchInput({ rootId: "DOCUMENTS", query: "informe", extensions: [".pdf.exe"] }),
      "FILE_EXTENSION_INVALID"
    );
    expectFailureCode(
      validateFileSearchInput({ rootId: "DOCUMENTS", query: "informe", includeContents: true }),
      "FILE_UNKNOWN_FIELD"
    );
    expectFailureCode(
      validateFileSearchInput({ rootId: "DOCUMENTS", query: "informe", limit: 101 }),
      "FILE_LIMIT_INVALID"
    );
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
