import {
  APPROVED_FILE_ROOTS,
  FILE_ERROR_CODES,
  type ApprovedFileRoot,
  type FileErrorCode,
  type FileOperationResult,
  type SafeFileReference
} from "../../shared/file-contracts";

type InputObject = Record<string, unknown>;

const relativePathMaximumLength = 2048;
const windowsDrivePattern = /^[A-Za-z]:/;
const unsafeRelativePathPattern = /[\u0000\r\n/:*?"<>|]/;

const validationMessages: Record<FileErrorCode, string> = {
  FILE_INPUT_INVALID: "La solicitud de búsqueda no es válida.",
  FILE_UNKNOWN_FIELD: "La solicitud contiene campos no permitidos.",
  FILE_ROOT_INVALID: "La ubicación seleccionada no está autorizada.",
  FILE_RELATIVE_PATH_INVALID: "La ubicación relativa no es válida.",
  FILE_ROOT_UNAVAILABLE: "No se pudo acceder a la ubicación autorizada."
};

const createFailure = <T>(code: FileErrorCode): FileOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: validationMessages[code] }
});

const createSuccess = <T>(data: T): FileOperationResult<T> => ({ ok: true, data });

export const isApprovedFileRoot = (value: unknown): value is ApprovedFileRoot =>
  typeof value === "string" && APPROVED_FILE_ROOTS.includes(value as ApprovedFileRoot);

export const validateRootRelativePath = (value: unknown): FileOperationResult<string> => {
  if (typeof value !== "string" || value.length === 0 || value.length > relativePathMaximumLength) {
    return createFailure(FILE_ERROR_CODES.relativePathInvalid);
  }

  if (
    value !== value.trim() ||
    unsafeRelativePathPattern.test(value) ||
    windowsDrivePattern.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("\\") ||
    value.includes("\\\\")
  ) {
    return createFailure(FILE_ERROR_CODES.relativePathInvalid);
  }

  const segments = value.split("\\");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return createFailure(FILE_ERROR_CODES.relativePathInvalid);
  }

  return createSuccess(value);
};

export const validateSafeFileReference = (value: unknown): FileOperationResult<SafeFileReference> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return createFailure(FILE_ERROR_CODES.inputInvalid);
  }
  const record = value as InputObject;
  if (Object.keys(record).some((key) => key !== "rootId" && key !== "relativePath")) {
    return createFailure(FILE_ERROR_CODES.unknownField);
  }
  if (!isApprovedFileRoot(record.rootId)) return createFailure(FILE_ERROR_CODES.rootInvalid);
  const relativePath = validateRootRelativePath(record.relativePath);
  if (!relativePath.ok) return relativePath;
  return createSuccess({ rootId: record.rootId, relativePath: relativePath.data });
};
