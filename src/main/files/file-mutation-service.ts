import {
  lstat as defaultLstat,
  mkdir as defaultMkdir,
  realpath as defaultRealpath
} from "node:fs/promises";
import path from "node:path";
import {
  FILE_ERROR_CODES,
  type CreateFolderInput,
  type FileEntryType,
  type FileErrorCode,
  type FileMutationOperation,
  type FileOperationResult,
  type MoveFileInput,
  type RenameFileInput,
  type RenameFolderInput,
  type SafeFileMutationRecord,
  type SafeFileReference
} from "../../shared/file-contracts";
import {
  createApprovedFileRootResolver,
  type ApprovedFileRootResolver,
  type ResolvedApprovedFileRoot
} from "./approved-file-roots";
import {
  isCanonicalPathWithinRoot,
  toRootRelativePath,
  type FilePathStats
} from "./file-path-boundary";
import {
  validateCreateFolderInput,
  validateMoveFileInput,
  validateRenameFileInput,
  validateRenameFolderInput,
  validateSafeFileReference,
  validateSingleWindowsName
} from "./file-validation";
import {
  createWindowsAtomicMove,
  type AtomicMoveResult,
  type WindowsAtomicMove
} from "./windows-atomic-move";

type ExpectedEntryType = "FILE" | "DIRECTORY";

type ResolvedMutationTarget = {
  root: ResolvedApprovedFileRoot;
  canonicalPath: string;
  stats: FilePathStats;
};

type FileMutationDependencies = {
  rootResolver: ApprovedFileRootResolver;
  lstat: (targetPath: string) => Promise<FilePathStats>;
  realpath: (targetPath: string) => Promise<string>;
  mkdir: (targetPath: string) => Promise<unknown>;
  atomicMove: WindowsAtomicMove;
  logError: (message: string) => void;
};

export type FileMutationService = {
  createFolder: (input: unknown) => Promise<FileOperationResult<SafeFileMutationRecord>>;
  renameFile: (input: unknown) => Promise<FileOperationResult<SafeFileMutationRecord>>;
  renameFolder: (input: unknown) => Promise<FileOperationResult<SafeFileMutationRecord>>;
  moveFile: (input: unknown) => Promise<FileOperationResult<SafeFileMutationRecord>>;
  /** Main-only helper for an immutable, precomputed organization destination. */
  moveFileToNamedDestination?: (
    input: PlannedFileMoveInput
  ) => Promise<FileOperationResult<SafeFileMutationRecord>>;
};

export type PlannedFileMoveInput = {
  source: SafeFileReference;
  destinationDirectory: SafeFileReference;
  destinationName: string;
};

const mutationMessages: Record<FileErrorCode, string> = {
  FILE_INPUT_INVALID: "La solicitud de archivos no es válida.",
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
  error: { code, userMessage: mutationMessages[code] }
});

const isSystemErrorCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;

const getEntryType = (stats: FilePathStats): FileEntryType | undefined => {
  if (stats.isFile()) return "FILE";
  if (stats.isDirectory()) return "DIRECTORY";
  return undefined;
};

const isExpectedType = (stats: FilePathStats, expectedType: ExpectedEntryType): boolean =>
  expectedType === "FILE" ? stats.isFile() : stats.isDirectory();

export const createFileMutationService = (
  overrides: Partial<FileMutationDependencies> = {}
): FileMutationService => {
  const dependencies: FileMutationDependencies = {
    rootResolver: overrides.rootResolver ?? createApprovedFileRootResolver(),
    lstat: overrides.lstat ?? defaultLstat,
    realpath: overrides.realpath ?? defaultRealpath,
    mkdir: overrides.mkdir ?? defaultMkdir,
    atomicMove: overrides.atomicMove ?? createWindowsAtomicMove(),
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  const resolveExisting = async (
    reference: SafeFileReference,
    expectedType: ExpectedEntryType,
    role: "SOURCE" | "DESTINATION"
  ): Promise<FileOperationResult<ResolvedMutationTarget>> => {
    const rootResult = await dependencies.rootResolver.resolve(reference.rootId);
    if (!rootResult.ok) return rootResult;
    const requestedPath = path.win32.resolve(rootResult.data.canonicalPath, reference.relativePath);
    if (!isCanonicalPathWithinRoot(rootResult.data.canonicalPath, requestedPath)) {
      return createFailure(FILE_ERROR_CODES.mutationFailed);
    }

    let stats: FilePathStats;
    try {
      stats = await dependencies.lstat(requestedPath);
    } catch (error) {
      return createFailure(
        isSystemErrorCode(error, "ENOENT")
          ? role === "SOURCE"
            ? FILE_ERROR_CODES.sourceNotFound
            : FILE_ERROR_CODES.destinationNotFound
          : FILE_ERROR_CODES.mutationFailed
      );
    }
    if (stats.isSymbolicLink()) return createFailure(FILE_ERROR_CODES.reparsePointRejected);
    if (!isExpectedType(stats, expectedType)) {
      return createFailure(
        role === "SOURCE" ? FILE_ERROR_CODES.sourceTypeInvalid : FILE_ERROR_CODES.destinationTypeInvalid
      );
    }

    try {
      const canonicalPath = await dependencies.realpath(requestedPath);
      if (!isCanonicalPathWithinRoot(rootResult.data.canonicalPath, canonicalPath)) {
        return createFailure(FILE_ERROR_CODES.mutationFailed);
      }
      return { ok: true, data: { root: rootResult.data, canonicalPath, stats } };
    } catch (error) {
      return createFailure(
        isSystemErrorCode(error, "ENOENT")
          ? role === "SOURCE"
            ? FILE_ERROR_CODES.sourceNotFound
            : FILE_ERROR_CODES.destinationNotFound
          : FILE_ERROR_CODES.mutationFailed
      );
    }
  };

  const resolveExistingPath = async (
    root: ResolvedApprovedFileRoot,
    targetPath: string,
    expectedType: ExpectedEntryType,
    role: "SOURCE" | "DESTINATION"
  ): Promise<FileOperationResult<ResolvedMutationTarget>> => {
    const relativePath = toRootRelativePath(root.canonicalPath, targetPath);
    if (!relativePath) return createFailure(FILE_ERROR_CODES.mutationFailed);
    return resolveExisting({ rootId: root.rootId, relativePath }, expectedType, role);
  };

  const assertNoCollision = async (targetPath: string): Promise<FileOperationResult<undefined>> => {
    try {
      await dependencies.lstat(targetPath);
      return createFailure(FILE_ERROR_CODES.collision);
    } catch (error) {
      if (isSystemErrorCode(error, "ENOENT")) return { ok: true, data: undefined };
      return createFailure(FILE_ERROR_CODES.mutationFailed);
    }
  };

  const verifyCreatedTarget = async (
    root: ResolvedApprovedFileRoot,
    targetPath: string,
    expectedType: ExpectedEntryType,
    operation: FileMutationOperation
  ): Promise<FileOperationResult<SafeFileMutationRecord>> => {
    const target = await resolveExistingPath(root, targetPath, expectedType, "DESTINATION");
    if (!target.ok) return target;
    const relativePath = toRootRelativePath(root.canonicalPath, target.data.canonicalPath);
    const entryType = getEntryType(target.data.stats);
    if (!relativePath || !entryType) return createFailure(FILE_ERROR_CODES.mutationFailed);
    return {
      ok: true,
      data: { operation, entryType, reference: { rootId: root.rootId, relativePath } }
    };
  };

  const mapMutationFailure = <T>(error: unknown): FileOperationResult<T> => {
    if (isSystemErrorCode(error, "EEXIST")) return createFailure(FILE_ERROR_CODES.collision);
    if (isSystemErrorCode(error, "EXDEV")) return createFailure(FILE_ERROR_CODES.crossVolumeUnsupported);
    if (isSystemErrorCode(error, "ENOENT")) return createFailure(FILE_ERROR_CODES.sourceNotFound);
    dependencies.logError("File mutation operation failed.");
    return createFailure(FILE_ERROR_CODES.mutationFailed);
  };

  const mapAtomicMoveResult = <T>(result: AtomicMoveResult): FileOperationResult<T> => {
    if (result.ok) return { ok: true, data: undefined as T };
    switch (result.reason) {
      case "COLLISION":
        return createFailure(FILE_ERROR_CODES.collision);
      case "CROSS_VOLUME":
        return createFailure(FILE_ERROR_CODES.crossVolumeUnsupported);
      case "SOURCE_NOT_FOUND":
        return createFailure(FILE_ERROR_CODES.sourceNotFound);
      case "UNAVAILABLE":
        return createFailure(FILE_ERROR_CODES.nativeMoveUnavailable);
      case "FAILED":
        return createFailure(FILE_ERROR_CODES.mutationFailed);
    }
  };

  const runAtomicMove = <T>(
    sourcePath: string,
    destinationPath: string
  ): FileOperationResult<T> => {
    try {
      return mapAtomicMoveResult<T>(dependencies.atomicMove.moveNoReplace(sourcePath, destinationPath));
    } catch {
      dependencies.logError("Windows atomic move wrapper failed unexpectedly.");
      return createFailure(FILE_ERROR_CODES.mutationFailed);
    }
  };

  const resolveRenameParent = async (
    source: ResolvedMutationTarget
  ): Promise<FileOperationResult<ResolvedMutationTarget>> =>
    resolveExistingPath(
      source.root,
      path.win32.dirname(source.canonicalPath),
      "DIRECTORY",
      "DESTINATION"
    );

  const moveToNamedDestination = async (
    input: PlannedFileMoveInput
  ): Promise<FileOperationResult<SafeFileMutationRecord>> => {
    const sourceReference = validateSafeFileReference(input.source);
    if (!sourceReference.ok) return sourceReference;
    const destinationReference = validateSafeFileReference(input.destinationDirectory);
    if (!destinationReference.ok) return destinationReference;
    const destinationName = validateSingleWindowsName(input.destinationName);
    if (!destinationName.ok) return destinationName;

    const source = await resolveExisting(sourceReference.data, "FILE", "SOURCE");
    if (!source.ok) return source;
    const destination = await resolveExisting(destinationReference.data, "DIRECTORY", "DESTINATION");
    if (!destination.ok) return destination;
    const targetPath = path.win32.join(destination.data.canonicalPath, destinationName.data);
    if (!isCanonicalPathWithinRoot(destination.data.root.canonicalPath, targetPath)) {
      return createFailure(FILE_ERROR_CODES.mutationFailed);
    }
    const collision = await assertNoCollision(targetPath);
    if (!collision.ok) return collision;

    const verifiedSource = await resolveExisting(sourceReference.data, "FILE", "SOURCE");
    if (!verifiedSource.ok) return verifiedSource;
    const verifiedDestination = await resolveExisting(destinationReference.data, "DIRECTORY", "DESTINATION");
    if (!verifiedDestination.ok) return verifiedDestination;
    const verifiedTargetPath = path.win32.join(verifiedDestination.data.canonicalPath, destinationName.data);
    if (!isCanonicalPathWithinRoot(verifiedDestination.data.root.canonicalPath, verifiedTargetPath)) {
      return createFailure(FILE_ERROR_CODES.mutationFailed);
    }
    const finalCollision = await assertNoCollision(verifiedTargetPath);
    if (!finalCollision.ok) return finalCollision;
    const moved = runAtomicMove<undefined>(verifiedSource.data.canonicalPath, verifiedTargetPath);
    if (!moved.ok) return moved;
    return verifyCreatedTarget(verifiedDestination.data.root, verifiedTargetPath, "FILE", "MOVE_FILE");
  };

  return {
    createFolder: async (input) => {
      const validation = validateCreateFolderInput(input);
      if (!validation.ok) return validation;
      const parent = await resolveExisting(validation.data.parentDirectory, "DIRECTORY", "DESTINATION");
      if (!parent.ok) return parent;
      const targetPath = path.win32.join(parent.data.canonicalPath, validation.data.name);
      if (!isCanonicalPathWithinRoot(parent.data.root.canonicalPath, targetPath)) {
        return createFailure(FILE_ERROR_CODES.mutationFailed);
      }
      const collision = await assertNoCollision(targetPath);
      if (!collision.ok) return collision;

      const verifiedParent = await resolveExisting(
        validation.data.parentDirectory,
        "DIRECTORY",
        "DESTINATION"
      );
      if (!verifiedParent.ok) return verifiedParent;
      const verifiedTargetPath = path.win32.join(verifiedParent.data.canonicalPath, validation.data.name);
      if (!isCanonicalPathWithinRoot(verifiedParent.data.root.canonicalPath, verifiedTargetPath)) {
        return createFailure(FILE_ERROR_CODES.mutationFailed);
      }
      const finalCollision = await assertNoCollision(verifiedTargetPath);
      if (!finalCollision.ok) return finalCollision;
      try {
        await dependencies.mkdir(verifiedTargetPath);
      } catch (error) {
        return mapMutationFailure(error);
      }
      return verifyCreatedTarget(
        verifiedParent.data.root,
        verifiedTargetPath,
        "DIRECTORY",
        "CREATE_FOLDER"
      );
    },

    renameFile: async (input) => {
      const validation = validateRenameFileInput(input);
      if (!validation.ok) return validation;
      const source = await resolveExisting(validation.data.source, "FILE", "SOURCE");
      if (!source.ok) return source;
      const parent = await resolveRenameParent(source.data);
      if (!parent.ok) return parent;
      const targetPath = path.win32.join(parent.data.canonicalPath, validation.data.newName);
      const collision = await assertNoCollision(targetPath);
      if (!collision.ok) return collision;

      const verifiedSource = await resolveExisting(validation.data.source, "FILE", "SOURCE");
      if (!verifiedSource.ok) return verifiedSource;
      const verifiedParent = await resolveRenameParent(verifiedSource.data);
      if (!verifiedParent.ok) return verifiedParent;
      const verifiedTargetPath = path.win32.join(verifiedParent.data.canonicalPath, validation.data.newName);
      if (!isCanonicalPathWithinRoot(verifiedParent.data.root.canonicalPath, verifiedTargetPath)) {
        return createFailure(FILE_ERROR_CODES.mutationFailed);
      }
      const finalCollision = await assertNoCollision(verifiedTargetPath);
      if (!finalCollision.ok) return finalCollision;
      const moved = runAtomicMove<undefined>(verifiedSource.data.canonicalPath, verifiedTargetPath);
      if (!moved.ok) return moved;
      return verifyCreatedTarget(
        verifiedSource.data.root,
        verifiedTargetPath,
        "FILE",
        "RENAME_FILE"
      );
    },

    renameFolder: async (input) => {
      const validation = validateRenameFolderInput(input);
      if (!validation.ok) return validation;
      const source = await resolveExisting(validation.data.source, "DIRECTORY", "SOURCE");
      if (!source.ok) return source;
      const parent = await resolveRenameParent(source.data);
      if (!parent.ok) return parent;
      const targetPath = path.win32.join(parent.data.canonicalPath, validation.data.newName);
      const collision = await assertNoCollision(targetPath);
      if (!collision.ok) return collision;

      const verifiedSource = await resolveExisting(validation.data.source, "DIRECTORY", "SOURCE");
      if (!verifiedSource.ok) return verifiedSource;
      const verifiedParent = await resolveRenameParent(verifiedSource.data);
      if (!verifiedParent.ok) return verifiedParent;
      const verifiedTargetPath = path.win32.join(verifiedParent.data.canonicalPath, validation.data.newName);
      if (!isCanonicalPathWithinRoot(verifiedParent.data.root.canonicalPath, verifiedTargetPath)) {
        return createFailure(FILE_ERROR_CODES.mutationFailed);
      }
      const finalCollision = await assertNoCollision(verifiedTargetPath);
      if (!finalCollision.ok) return finalCollision;
      const moved = runAtomicMove<undefined>(verifiedSource.data.canonicalPath, verifiedTargetPath);
      if (!moved.ok) return moved;
      return verifyCreatedTarget(
        verifiedSource.data.root,
        verifiedTargetPath,
        "DIRECTORY",
        "RENAME_FOLDER"
      );
    },

    moveFile: async (input) => {
      const validation = validateMoveFileInput(input);
      if (!validation.ok) return validation;
      const source = await resolveExisting(validation.data.source, "FILE", "SOURCE");
      if (!source.ok) return source;
      const destination = await resolveExisting(
        validation.data.destinationDirectory,
        "DIRECTORY",
        "DESTINATION"
      );
      if (!destination.ok) return destination;
      if (
        source.data.root.rootId === destination.data.root.rootId &&
        source.data.canonicalPath.toLocaleLowerCase("en-US") ===
          path.win32.join(destination.data.canonicalPath, path.win32.basename(source.data.canonicalPath)).toLocaleLowerCase("en-US")
      ) {
        return createFailure(FILE_ERROR_CODES.noOp);
      }

      const targetPath = path.win32.join(
        destination.data.canonicalPath,
        path.win32.basename(source.data.canonicalPath)
      );
      if (!isCanonicalPathWithinRoot(destination.data.root.canonicalPath, targetPath)) {
        return createFailure(FILE_ERROR_CODES.mutationFailed);
      }
      const collision = await assertNoCollision(targetPath);
      if (!collision.ok) return collision;

      const verifiedSource = await resolveExisting(validation.data.source, "FILE", "SOURCE");
      if (!verifiedSource.ok) return verifiedSource;
      const verifiedDestination = await resolveExisting(
        validation.data.destinationDirectory,
        "DIRECTORY",
        "DESTINATION"
      );
      if (!verifiedDestination.ok) return verifiedDestination;
      const verifiedTargetPath = path.win32.join(
        verifiedDestination.data.canonicalPath,
        path.win32.basename(verifiedSource.data.canonicalPath)
      );
      if (!isCanonicalPathWithinRoot(verifiedDestination.data.root.canonicalPath, verifiedTargetPath)) {
        return createFailure(FILE_ERROR_CODES.mutationFailed);
      }
      const finalCollision = await assertNoCollision(verifiedTargetPath);
      if (!finalCollision.ok) return finalCollision;
      const moved = runAtomicMove<undefined>(verifiedSource.data.canonicalPath, verifiedTargetPath);
      if (!moved.ok) return moved;
      return verifyCreatedTarget(
        verifiedDestination.data.root,
        verifiedTargetPath,
        "FILE",
        "MOVE_FILE"
      );
    },

    moveFileToNamedDestination: moveToNamedDestination
  };
};
