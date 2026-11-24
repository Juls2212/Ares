import type { OperationResult } from "./contracts";

export const APPROVED_FILE_ROOTS = ["DOCUMENTS", "DOWNLOADS", "DESKTOP"] as const;

export type ApprovedFileRoot = (typeof APPROVED_FILE_ROOTS)[number];

export type SafeFileReference = {
  rootId: ApprovedFileRoot;
  relativePath: string;
};

/** Only the codes still produced by the approved-root resolver and reference validation. */
export const FILE_ERROR_CODES = {
  inputInvalid: "FILE_INPUT_INVALID",
  unknownField: "FILE_UNKNOWN_FIELD",
  rootInvalid: "FILE_ROOT_INVALID",
  relativePathInvalid: "FILE_RELATIVE_PATH_INVALID",
  rootUnavailable: "FILE_ROOT_UNAVAILABLE"
} as const;

export type FileErrorCode = (typeof FILE_ERROR_CODES)[keyof typeof FILE_ERROR_CODES];

export type FileOperationResult<T> = OperationResult<T>;
