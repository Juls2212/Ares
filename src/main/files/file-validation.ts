import {
  APPROVED_FILE_ROOTS,
  FILE_ERROR_CODES,
  type ApprovedFileRoot,
  type FileErrorCode,
  type FileOperationResult,
  type FileSearchInput,
  type OrganizeFilesInput,
  type CreateFolderInput,
  type MoveFileInput,
  type RenameFileInput,
  type RenameFolderInput,
  type SafeFileReference
} from "../../shared/file-contracts";

type InputObject = Record<string, unknown>;

const queryMaximumLength = 240;
const extensionMaximumLength = 20;
const extensionMaximumCount = 20;
const maximumResultLimit = 100;
const relativePathMaximumLength = 2048;
const windowsDrivePattern = /^[A-Za-z]:/;
const unsafeRelativePathPattern = /[\u0000\r\n/:*?"<>|]/;
const extensionPattern = /^[A-Za-z0-9]{1,20}$/;
const fileNameMaximumLength = 255;
const unsafeNamePattern = /[\u0000\\/:*?"<>|\r\n&;()$`!^%]/;
const reservedDeviceNames = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

const validationMessages: Record<FileErrorCode, string> = {
  FILE_INPUT_INVALID: "La solicitud de búsqueda no es válida.",
  FILE_UNKNOWN_FIELD: "La solicitud contiene campos no permitidos.",
  FILE_ROOT_INVALID: "La ubicación seleccionada no está autorizada.",
  FILE_QUERY_INVALID: "El texto de búsqueda no es válido.",
  FILE_EXTENSION_INVALID: "El filtro de extensiones no es válido.",
  FILE_RELATIVE_PATH_INVALID: "La ubicación relativa no es válida.",
  FILE_LIMIT_INVALID: "El límite de resultados no es válido.",
  FILE_ROOT_UNAVAILABLE: "No se pudo acceder a la ubicación autorizada.",
  FILE_SEARCH_SCOPE_UNAVAILABLE: "No se pudo acceder al alcance de búsqueda autorizado.",
  FILE_SEARCH_UNAVAILABLE: "No se pudo completar la búsqueda de archivos.",
  FILE_NAME_INVALID: "El nombre solicitado no es válido.",
  FILE_NAME_RESERVED: "El nombre solicitado está reservado por Windows.",
  FILE_SOURCE_NOT_FOUND: "No se encontró el elemento de origen.",
  FILE_DESTINATION_NOT_FOUND: "No se encontró la carpeta de destino.",
  FILE_SOURCE_TYPE_INVALID: "El elemento de origen no tiene el tipo esperado.",
  FILE_DESTINATION_TYPE_INVALID: "La carpeta de destino no es válida.",
  FILE_REPARSE_POINT_REJECTED: "No se permite operar sobre enlaces o puntos de redirección.",
  FILE_COLLISION: "Ya existe un elemento con ese nombre en el destino.",
  FILE_NO_OP: "La operación no produciría ningún cambio.",
  FILE_CROSS_VOLUME_UNSUPPORTED: "No se puede mover el archivo entre volúmenes autorizados.",
  FILE_NATIVE_MOVE_UNAVAILABLE: "La operación segura de archivos no está disponible.",
  FILE_MUTATION_FAILED: "No se pudo completar la operación de archivos.",
  FILE_ORGANIZATION_UNAVAILABLE: "No se pudo analizar la carpeta autorizada."
};

const createFailure = <T>(code: FileErrorCode): FileOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: validationMessages[code] }
});

const createSuccess = <T>(data: T): FileOperationResult<T> => ({ ok: true, data });

const hasOwn = (input: InputObject, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(input, key);

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

export const validateSingleWindowsName = (value: unknown): FileOperationResult<string> => {
  if (typeof value !== "string" || value.length === 0 || value.length > fileNameMaximumLength) {
    return createFailure(FILE_ERROR_CODES.nameInvalid);
  }
  if (
    value !== value.trim() ||
    value === "." ||
    value === ".." ||
    value.endsWith(".") ||
    value.endsWith(" ") ||
    unsafeNamePattern.test(value)
  ) {
    return createFailure(FILE_ERROR_CODES.nameInvalid);
  }

  const deviceBaseName = value.split(".")[0].replace(/[ .]+$/, "").toLocaleUpperCase("en-US");
  if (reservedDeviceNames.has(deviceBaseName)) return createFailure(FILE_ERROR_CODES.nameReserved);
  return createSuccess(value);
};

const validateMutationObject = (
  input: unknown,
  allowedKeys: readonly string[]
): FileOperationResult<InputObject> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return createFailure(FILE_ERROR_CODES.inputInvalid);
  }
  const record = input as InputObject;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    return createFailure(FILE_ERROR_CODES.unknownField);
  }
  return createSuccess(record);
};

const isSameNormalizedName = (left: string, right: string): boolean =>
  left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");

const getRelativeParent = (relativePath: string): string => {
  const separatorIndex = relativePath.lastIndexOf("\\");
  return separatorIndex === -1 ? "" : relativePath.slice(0, separatorIndex);
};

export const validateCreateFolderInput = (input: unknown): FileOperationResult<CreateFolderInput> => {
  const object = validateMutationObject(input, ["parentDirectory", "name"]);
  if (!object.ok) return object;
  const parentDirectory = validateSafeFileReference(object.data.parentDirectory);
  if (!parentDirectory.ok) return parentDirectory;
  const name = validateSingleWindowsName(object.data.name);
  if (!name.ok) return name;
  return createSuccess({ parentDirectory: parentDirectory.data, name: name.data });
};

const validateRenameInput = <T extends RenameFileInput | RenameFolderInput>(
  input: unknown
): FileOperationResult<T> => {
  const object = validateMutationObject(input, ["source", "newName"]);
  if (!object.ok) return object;
  const source = validateSafeFileReference(object.data.source);
  if (!source.ok) return source;
  const newName = validateSingleWindowsName(object.data.newName);
  if (!newName.ok) return newName;
  const currentName = source.data.relativePath.split("\\").at(-1);
  if (currentName === undefined || isSameNormalizedName(currentName, newName.data)) {
    return createFailure(FILE_ERROR_CODES.noOp);
  }
  return createSuccess({ source: source.data, newName: newName.data } as T);
};

export const validateRenameFileInput = (input: unknown): FileOperationResult<RenameFileInput> =>
  validateRenameInput<RenameFileInput>(input);

export const validateRenameFolderInput = (input: unknown): FileOperationResult<RenameFolderInput> =>
  validateRenameInput<RenameFolderInput>(input);

export const validateMoveFileInput = (input: unknown): FileOperationResult<MoveFileInput> => {
  const object = validateMutationObject(input, ["source", "destinationDirectory"]);
  if (!object.ok) return object;
  const source = validateSafeFileReference(object.data.source);
  if (!source.ok) return source;
  const destinationDirectory = validateSafeFileReference(object.data.destinationDirectory);
  if (!destinationDirectory.ok) return destinationDirectory;

  if (
    source.data.rootId === destinationDirectory.data.rootId &&
    isSameNormalizedName(getRelativeParent(source.data.relativePath), destinationDirectory.data.relativePath)
  ) {
    return createFailure(FILE_ERROR_CODES.noOp);
  }

  return createSuccess({ source: source.data, destinationDirectory: destinationDirectory.data });
};

const isWithinRelativeFolder = (folder: string, target: string): boolean => {
  const normalizedFolder = folder.toLocaleLowerCase("en-US");
  const normalizedTarget = target.toLocaleLowerCase("en-US");
  return normalizedTarget.startsWith(`${normalizedFolder}\\`);
};

/** Validates a read-only organization scope and explicit exclusions only. */
export const validateOrganizeFilesInput = (input: unknown): FileOperationResult<OrganizeFilesInput> => {
  const object = validateMutationObject(input, ["folder", "exclusions"]);
  if (!object.ok) return object;
  const folder = validateSafeFileReference(object.data.folder);
  if (!folder.ok) return folder;

  if (object.data.exclusions === undefined) return createSuccess({ folder: folder.data });
  if (!Array.isArray(object.data.exclusions) || object.data.exclusions.length > 100) {
    return createFailure(FILE_ERROR_CODES.inputInvalid);
  }

  const seen = new Set<string>();
  const exclusions: SafeFileReference[] = [];
  for (const candidate of object.data.exclusions) {
    const exclusion = validateSafeFileReference(candidate);
    if (!exclusion.ok) return exclusion;
    if (
      exclusion.data.rootId !== folder.data.rootId ||
      !isWithinRelativeFolder(folder.data.relativePath, exclusion.data.relativePath)
    ) {
      return createFailure(FILE_ERROR_CODES.relativePathInvalid);
    }
    const key = `${exclusion.data.rootId}:${exclusion.data.relativePath.toLocaleLowerCase("en-US")}`;
    if (seen.has(key)) return createFailure(FILE_ERROR_CODES.inputInvalid);
    seen.add(key);
    exclusions.push(exclusion.data);
  }

  return createSuccess({ folder: folder.data, ...(exclusions.length === 0 ? {} : { exclusions }) });
};

const validateExtensions = (value: unknown): FileOperationResult<string[] | undefined> => {
  if (value === undefined) return createSuccess(undefined);
  if (!Array.isArray(value) || value.length === 0 || value.length > extensionMaximumCount) {
    return createFailure(FILE_ERROR_CODES.extensionInvalid);
  }

  const extensions: string[] = [];
  const normalizedExtensions = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return createFailure(FILE_ERROR_CODES.extensionInvalid);
    const extension = item.startsWith(".") ? item.slice(1) : item;
    if (
      extension.length === 0 ||
      extension.length > extensionMaximumLength ||
      !extensionPattern.test(extension)
    ) {
      return createFailure(FILE_ERROR_CODES.extensionInvalid);
    }
    const normalizedExtension = extension.toLocaleLowerCase("en-US");
    if (!normalizedExtensions.has(normalizedExtension)) {
      normalizedExtensions.add(normalizedExtension);
      extensions.push(normalizedExtension);
    }
  }

  return createSuccess(extensions);
};

export const validateFileSearchInput = (input: unknown): FileOperationResult<FileSearchInput> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return createFailure(FILE_ERROR_CODES.inputInvalid);
  }

  const record = input as InputObject;
  const allowedKeys = ["rootId", "query", "extensions", "relativePath", "limit"];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    return createFailure(FILE_ERROR_CODES.unknownField);
  }

  if (!isApprovedFileRoot(record.rootId)) return createFailure(FILE_ERROR_CODES.rootInvalid);
  if (typeof record.query !== "string") return createFailure(FILE_ERROR_CODES.queryInvalid);
  const query = record.query.trim();
  if (!query || query.length > queryMaximumLength) {
    return createFailure(FILE_ERROR_CODES.queryInvalid);
  }

  const extensions = validateExtensions(record.extensions);
  if (!extensions.ok) return extensions;

  let relativePath: string | undefined;
  if (hasOwn(record, "relativePath")) {
    const validation = validateRootRelativePath(record.relativePath);
    if (!validation.ok) return validation;
    relativePath = validation.data;
  }

  let limit: number | undefined;
  if (hasOwn(record, "limit")) {
    if (
      typeof record.limit !== "number" ||
      !Number.isInteger(record.limit) ||
      record.limit < 1 ||
      record.limit > maximumResultLimit
    ) {
      return createFailure(FILE_ERROR_CODES.limitInvalid);
    }
    limit = record.limit;
  }

  return createSuccess({
    rootId: record.rootId,
    query,
    ...(extensions.data === undefined ? {} : { extensions: extensions.data }),
    ...(relativePath === undefined ? {} : { relativePath }),
    ...(limit === undefined ? {} : { limit })
  });
};
