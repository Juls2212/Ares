import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  MAX_FOUND_ORDINAL,
  SUPERVISED_FILE_ROOTS,
  SUPERVISED_FILE_ROOT_LABELS,
  type CreateSupervisedFolderInput,
  type SupervisedFileMutationData,
  type FoundEntryKind,
  type FoundFileSummary,
  type SearchFilesInput,
  type SupervisedFileRoot,
  type SupervisedFileSearchData
} from "../../shared/supervised-file-contracts";
import { filesFailure, filesSuccess, type FilesFailureCode, type FilesResult } from "./supervised-file-failures";
import {
  classifyEntry,
  computeRenamedName,
  hasBlockedExtension,
  isFileSearchKind,
  isFoundOrdinal,
  isOpenBlocked,
  isSkippedEntryName,
  isSupervisedFileRoot,
  matchesKind,
  normalizeForMatching,
  parseSelection,
  validateFolderName,
  validateSearchQuery
} from "./supervised-file-validation";

export const MAX_SEARCH_DEPTH = 6;
export const MAX_VISITED_ENTRIES = 20_000;
export const MAX_SEARCH_DURATION_MS = 5_000;
export const MAX_SEARCH_RESULTS = 10;
export const LAST_SEARCH_LIFETIME_MS = 10 * 60 * 1000;
export const PREPARED_ACTION_LIFETIME_MS = 5 * 60 * 1000;
const MAX_PREPARED_ACTIONS = 8;
const CLOCK_CHECK_INTERVAL = 200;

type DirectoryEntry = {
  name: string;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
};

type EntryStats = {
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
};

/** The only filesystem operations this domain can perform. There is no write other than one mkdir. */
export type SupervisedFilesystem = {
  readdir: (directory: string) => Promise<DirectoryEntry[]>;
  lstat: (entry: string) => Promise<EntryStats>;
  realpath: (entry: string) => Promise<string>;
  mkdir: (directory: string) => Promise<void>;
  /** Renames or moves exactly one entry. There is deliberately no remove/unlink operation in this port. */
  rename: (from: string, to: string) => Promise<void>;
};

export type SupervisedShell = {
  showItemInFolder: (target: string) => void;
  openPath: (target: string) => Promise<string>;
  /** Sends one entry to the Recycle Bin. It is the only way an item can ever be removed. */
  trashItem: (target: string) => Promise<void>;
};

type SupervisedFileServiceDependencies = {
  filesystem: SupervisedFilesystem;
  shell: SupervisedShell;
  getKnownFolder: (root: SupervisedFileRoot) => string;
  now: () => number;
  generateIdentifier: () => string;
  logError: (message: string) => void;
};

type FoundEntry = {
  ordinal: number;
  name: string;
  kind: FoundEntryKind;
  root: SupervisedFileRoot;
  absolutePath: string;
};

type PreparedOpen = { type: "OPEN"; entry: FoundEntry; expiresAt: number };
type PreparedFolder = {
  type: "CREATE_FOLDER";
  root: SupervisedFileRoot;
  parent: { path: string; entry?: FoundEntry };
  name: string;
  expiresAt: number;
};
type PreparedRename = { type: "RENAME"; entry: FoundEntry; finalName: string; expiresAt: number };
type MoveDestination = { path: string; root: SupervisedFileRoot; entry?: FoundEntry };
type PreparedMove = { type: "MOVE"; entries: FoundEntry[]; destination: MoveDestination; expiresAt: number };
type PreparedOrganize = {
  type: "ORGANIZE";
  entries: FoundEntry[];
  root: SupervisedFileRoot;
  folderName: string;
  folderPath: string;
  createFolder: boolean;
  expiresAt: number;
};
type PreparedDelete = { type: "DELETE"; entry: FoundEntry; expiresAt: number };
type PreparedAction =
  | PreparedOpen
  | PreparedFolder
  | PreparedRename
  | PreparedMove
  | PreparedOrganize
  | PreparedDelete;

export type FoundFileNameResolution =
  | { state: "RESOLVED"; ordinal: number }
  | { state: "AMBIGUOUS" }
  | { state: "NONE" };

export type SupervisedFileService = {
  /** Count only: no names and no paths. Undefined when there is no unexpired, non-empty search. */
  getActiveSearchInfo: () => { resultCount: number } | undefined;
  /** Matches a spoken name against the last search by normalized exact or unique-substring comparison. */
  resolveFoundFileByName: (name: unknown) => FoundFileNameResolution;
  search: (input: unknown) => Promise<FilesResult<SupervisedFileSearchData>>;
  revealFound: (ordinal: unknown) => Promise<FilesResult<{ revealed: true }>>;
  prepareOpen: (ordinal: unknown) => Promise<FilesResult<{ preparedId: string; displayName: string; rootLabel: string }>>;
  commitOpen: (preparedId: unknown) => Promise<FilesResult<{ opened: true }>>;
  prepareCreateFolder: (
    input: unknown
  ) => Promise<FilesResult<{ preparedId: string; folderName: string; locationLabel: string }>>;
  commitCreateFolder: (preparedId: unknown) => Promise<FilesResult<{ created: true }>>;
  /** Matches a spoken folder name against FOLDER entries of the last search only. */
  resolveFoundFolderByName: (name: unknown) => FoundFileNameResolution;
  prepareRename: (
    input: unknown
  ) => Promise<FilesResult<{ preparedId: string; currentName: string; newName: string; kind: FoundEntryKind; rootLabel: string }>>;
  commitRename: (preparedId: unknown) => Promise<FilesResult<{ renamed: true }>>;
  prepareMove: (
    input: unknown
  ) => Promise<FilesResult<{ preparedId: string; itemCount: number; destinationLabel: string }>>;
  commitMove: (preparedId: unknown) => Promise<FilesResult<SupervisedFileMutationData>>;
  prepareOrganize: (
    input: unknown
  ) => Promise<FilesResult<{ preparedId: string; itemCount: number; folderName: string; createFolder: boolean; destinationLabel: string }>>;
  commitOrganize: (preparedId: unknown) => Promise<FilesResult<SupervisedFileMutationData>>;
  prepareDelete: (
    ordinal: unknown
  ) => Promise<FilesResult<{ preparedId: string; displayName: string; kind: FoundEntryKind; rootLabel: string }>>;
  commitDelete: (preparedId: unknown) => Promise<FilesResult<{ trashed: true }>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;

const isInside = (child: string, base: string): boolean => {
  const relative = path.relative(base, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const samePath = (left: string, right: string): boolean =>
  path.resolve(left).toLocaleLowerCase("en-US") === path.resolve(right).toLocaleLowerCase("en-US");

/** Punctuation-insensitive comparison form, so «informe_final.pdf» matches «informe final». */
const comparable = (value: string): string =>
  normalizeForMatching(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const withoutExtension = (value: string): string => value.replace(/\.[^.]+$/u, "");

const toSummary = (entry: FoundEntry): FoundFileSummary => ({
  ordinal: entry.ordinal,
  name: entry.name,
  kind: entry.kind,
  rootLabel: SUPERVISED_FILE_ROOT_LABELS[entry.root]
});

export const createSupervisedFileService = (
  overrides: Partial<SupervisedFileServiceDependencies> = {}
): SupervisedFileService => {
  const dependencies = {
    now: () => Date.now(),
    generateIdentifier: randomUUID,
    logError: (message: string) => console.error(message),
    ...overrides
  } as SupervisedFileServiceDependencies;
  const { filesystem, shell } = dependencies;

  let lastSearch: { entries: FoundEntry[]; expiresAt: number } | undefined;
  const prepared = new Map<string, PreparedAction>();

  /** Resolves a known folder to its canonical path at use time; an unavailable root is out of scope. */
  const resolveRoot = async (root: SupervisedFileRoot): Promise<string | undefined> => {
    try {
      return await filesystem.realpath(dependencies.getKnownFolder(root));
    } catch {
      return undefined;
    }
  };

  const activeEntries = (): FoundEntry[] => {
    if (!lastSearch || lastSearch.expiresAt <= dependencies.now()) {
      lastSearch = undefined;
      return [];
    }
    return lastSearch.entries;
  };

  const getActiveSearchInfo: SupervisedFileService["getActiveSearchInfo"] = () => {
    const entries = activeEntries();
    return entries.length > 0 ? { resultCount: entries.length } : undefined;
  };

  const resolveAmong = (name: unknown, entries: FoundEntry[]): FoundFileNameResolution => {
    if (typeof name !== "string") return { state: "NONE" };
    const needle = comparable(name);
    if (needle.length < 2) return { state: "NONE" };
    const exact = entries.filter(
      (entry) => comparable(entry.name) === needle || comparable(withoutExtension(entry.name)) === needle
    );
    if (exact.length === 1) return { state: "RESOLVED", ordinal: (exact[0] as FoundEntry).ordinal };
    if (exact.length > 1) return { state: "AMBIGUOUS" };
    const partial = entries.filter((entry) => comparable(entry.name).includes(needle));
    if (partial.length === 1) return { state: "RESOLVED", ordinal: (partial[0] as FoundEntry).ordinal };
    return partial.length > 1 ? { state: "AMBIGUOUS" } : { state: "NONE" };
  };

  const resolveFoundFileByName: SupervisedFileService["resolveFoundFileByName"] = (name) =>
    resolveAmong(name, activeEntries());

  const resolveFoundFolderByName: SupervisedFileService["resolveFoundFolderByName"] = (name) =>
    resolveAmong(name, activeEntries().filter((entry) => entry.kind === "FOLDER"));

  const invalidateSearch = (): void => {
    lastSearch = undefined;
  };

  const getFoundEntry = (ordinal: unknown): FoundEntry | undefined => {
    if (!isFoundOrdinal(ordinal) || ordinal > MAX_FOUND_ORDINAL) return undefined;
    if (!lastSearch || lastSearch.expiresAt <= dependencies.now()) {
      lastSearch = undefined;
      return undefined;
    }
    return lastSearch.entries.find((entry) => entry.ordinal === ordinal);
  };

  /** Re-validates, immediately before use, that an entry still exists inside its approved root. */
  const revalidateEntry = async (
    entry: FoundEntry,
    missingCode: FilesFailureCode = "FILES_STALE_SELECTION"
  ): Promise<FilesResult<true>> => {
    const root = await resolveRoot(entry.root);
    if (!root) return filesFailure("FILES_OUT_OF_SCOPE");
    try {
      const stats = await filesystem.lstat(entry.absolutePath);
      if (stats.isSymbolicLink()) return filesFailure("FILES_STALE_SELECTION");
      if (stats.isDirectory() !== (entry.kind === "FOLDER")) return filesFailure("FILES_STALE_SELECTION");
      const real = await filesystem.realpath(entry.absolutePath);
      if (!isInside(real, root)) return filesFailure("FILES_OUT_OF_SCOPE");
      if (!samePath(real, entry.absolutePath)) return filesFailure("FILES_STALE_SELECTION");
      return filesSuccess(true);
    } catch (error) {
      if (errorCodeOf(error) !== "ENOENT") dependencies.logError("Supervised file re-validation failed.");
      return filesFailure(errorCodeOf(error) === "ENOENT" ? missingCode : "FILES_STALE_SELECTION");
    }
  };

  const remember = (action: PreparedAction): string => {
    const now = dependencies.now();
    for (const [id, pending] of prepared) if (pending.expiresAt <= now) prepared.delete(id);
    while (prepared.size >= MAX_PREPARED_ACTIONS) {
      const oldest = prepared.keys().next().value;
      if (oldest === undefined) break;
      prepared.delete(oldest);
    }
    const id = dependencies.generateIdentifier();
    prepared.set(id, action);
    return id;
  };

  const takePrepared = <T extends PreparedAction["type"]>(
    preparedId: unknown,
    type: T
  ): Extract<PreparedAction, { type: T }> | undefined => {
    if (typeof preparedId !== "string") return undefined;
    const pending = prepared.get(preparedId);
    prepared.delete(preparedId);
    if (!pending || pending.type !== type || pending.expiresAt <= dependencies.now()) return undefined;
    return pending as Extract<PreparedAction, { type: T }>;
  };

  const search: SupervisedFileService["search"] = async (input) => {
    if (!isRecord(input) || !hasOnlyKeys(input, ["query", "root", "kind"])) return filesFailure("FILES_INVALID_QUERY");
    const query = validateSearchQuery(input.query);
    if (!query) return filesFailure("FILES_INVALID_QUERY");
    if (input.root !== undefined && !isSupervisedFileRoot(input.root)) return filesFailure("FILES_OUT_OF_SCOPE");
    if (input.kind !== undefined && !isFileSearchKind(input.kind)) return filesFailure("FILES_INVALID_QUERY");
    const request: Required<Pick<SearchFilesInput, "query">> & SearchFilesInput = {
      query,
      ...(input.root === undefined ? {} : { root: input.root }),
      ...(input.kind === undefined ? {} : { kind: input.kind })
    };
    const filter = request.kind ?? "ANY";
    const needle = normalizeForMatching(query);
    const roots = request.root ? [request.root] : [...SUPERVISED_FILE_ROOTS];

    const startedAt = dependencies.now();
    const found: FoundEntry[] = [];
    let visited = 0;
    let partial = false;
    let stop = false;
    let resolvedRoots = 0;

    for (const root of roots) {
      if (stop) break;
      const base = await resolveRoot(root);
      if (!base) continue;
      resolvedRoots += 1;
      const queue: Array<{ directory: string; depth: number }> = [{ directory: base, depth: 0 }];
      while (queue.length > 0 && !stop) {
        const current = queue.shift() as { directory: string; depth: number };
        if (dependencies.now() - startedAt > MAX_SEARCH_DURATION_MS) {
          partial = true;
          stop = true;
          break;
        }
        let entries: DirectoryEntry[];
        try {
          entries = await filesystem.readdir(current.directory);
        } catch {
          continue;
        }
        for (const entry of entries) {
          visited += 1;
          if (visited > MAX_VISITED_ENTRIES) {
            partial = true;
            stop = true;
            break;
          }
          if (visited % CLOCK_CHECK_INTERVAL === 0 && dependencies.now() - startedAt > MAX_SEARCH_DURATION_MS) {
            partial = true;
            stop = true;
            break;
          }
          if (isSkippedEntryName(entry.name) || entry.isSymbolicLink()) continue;
          const isDirectory = entry.isDirectory();
          const kind = classifyEntry(entry.name, isDirectory);
          if (matchesKind(filter, kind) && normalizeForMatching(entry.name).includes(needle)) {
            if (found.length >= MAX_SEARCH_RESULTS) {
              partial = true;
              stop = true;
              break;
            }
            found.push({
              ordinal: found.length + 1,
              name: entry.name,
              kind,
              root,
              absolutePath: path.join(current.directory, entry.name)
            });
          }
          if (isDirectory) {
            if (current.depth + 1 < MAX_SEARCH_DEPTH) {
              queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
            } else {
              partial = true;
            }
          }
        }
      }
    }

    if (resolvedRoots === 0) return filesFailure("FILES_OPERATION_FAILED");
    lastSearch = { entries: found, expiresAt: dependencies.now() + LAST_SEARCH_LIFETIME_MS };
    return filesSuccess({ resultCount: found.length, partial, items: found.map(toSummary) });
  };

  const revealFound: SupervisedFileService["revealFound"] = async (ordinal) => {
    const entry = getFoundEntry(ordinal);
    if (!entry) return filesFailure("FILES_STALE_SELECTION");
    const valid = await revalidateEntry(entry);
    if (!valid.ok) return valid;
    try {
      shell.showItemInFolder(entry.absolutePath);
      return filesSuccess({ revealed: true });
    } catch {
      dependencies.logError("Supervised file reveal failed.");
      return filesFailure("FILES_OPERATION_FAILED");
    }
  };

  const prepareOpen: SupervisedFileService["prepareOpen"] = async (ordinal) => {
    const entry = getFoundEntry(ordinal);
    if (!entry) return filesFailure("FILES_STALE_SELECTION");
    const valid = await revalidateEntry(entry);
    if (!valid.ok) return valid;
    if (entry.kind !== "FOLDER" && isOpenBlocked(entry.name)) return filesFailure("FILES_TYPE_BLOCKED");
    const preparedId = remember({
      type: "OPEN",
      entry: { ...entry },
      expiresAt: dependencies.now() + PREPARED_ACTION_LIFETIME_MS
    });
    return filesSuccess({ preparedId, displayName: entry.name, rootLabel: SUPERVISED_FILE_ROOT_LABELS[entry.root] });
  };

  const commitOpen: SupervisedFileService["commitOpen"] = async (preparedId) => {
    const pending = takePrepared(preparedId, "OPEN");
    if (!pending) return filesFailure("FILES_STALE_SELECTION");
    const valid = await revalidateEntry(pending.entry);
    if (!valid.ok) return valid;
    if (pending.entry.kind !== "FOLDER" && isOpenBlocked(pending.entry.name)) return filesFailure("FILES_TYPE_BLOCKED");
    try {
      // The operating-system default handler receives only this validated, Main-held path.
      const failure = await shell.openPath(pending.entry.absolutePath);
      if (failure) return filesFailure("FILES_OPERATION_FAILED");
      return filesSuccess({ opened: true });
    } catch {
      dependencies.logError("Supervised file open failed.");
      return filesFailure("FILES_OPERATION_FAILED");
    }
  };

  /** Verifies a parent is a real directory still inside its root; returns nothing the caller can misuse. */
  const revalidateParent = async (
    parent: PreparedFolder["parent"],
    root: SupervisedFileRoot
  ): Promise<FilesResult<true>> => {
    if (parent.entry) {
      if (parent.entry.kind !== "FOLDER") return filesFailure("FILES_OUT_OF_SCOPE");
      return revalidateEntry(parent.entry);
    }
    const base = await resolveRoot(root);
    return base && samePath(base, parent.path) ? filesSuccess(true) : filesFailure("FILES_OUT_OF_SCOPE");
  };

  const targetExists = async (target: string): Promise<FilesResult<boolean>> => {
    try {
      await filesystem.lstat(target);
      return filesSuccess(true);
    } catch (error) {
      if (errorCodeOf(error) === "ENOENT") return filesSuccess(false);
      dependencies.logError("Supervised folder target inspection failed.");
      return filesFailure("FILES_OPERATION_FAILED");
    }
  };

  const prepareCreateFolder: SupervisedFileService["prepareCreateFolder"] = async (input) => {
    if (!isRecord(input) || !hasOnlyKeys(input, ["folderName", "root", "parentOrdinal"])) {
      return filesFailure("FILES_INVALID_NAME");
    }
    const name = validateFolderName(input.folderName);
    if (!name) return filesFailure("FILES_INVALID_NAME");
    if (input.root !== undefined && !isSupervisedFileRoot(input.root)) return filesFailure("FILES_OUT_OF_SCOPE");

    let root: SupervisedFileRoot;
    let parent: PreparedFolder["parent"];
    let locationLabel: string;
    if (input.parentOrdinal !== undefined) {
      const entry = getFoundEntry(input.parentOrdinal);
      if (!entry) return filesFailure("FILES_STALE_SELECTION");
      if (entry.kind !== "FOLDER") return filesFailure("FILES_OUT_OF_SCOPE");
      if (input.root !== undefined && input.root !== entry.root) return filesFailure("FILES_OUT_OF_SCOPE");
      root = entry.root;
      parent = { path: entry.absolutePath, entry: { ...entry } };
      locationLabel = `${entry.name} (${SUPERVISED_FILE_ROOT_LABELS[root]})`;
    } else {
      if (input.root === undefined) return filesFailure("FILES_OUT_OF_SCOPE");
      root = input.root;
      const base = await resolveRoot(root);
      if (!base) return filesFailure("FILES_OUT_OF_SCOPE");
      parent = { path: base };
      locationLabel = SUPERVISED_FILE_ROOT_LABELS[root];
    }

    const valid = await revalidateParent(parent, root);
    if (!valid.ok) return valid;
    const exists = await targetExists(path.join(parent.path, name));
    if (!exists.ok) return exists;
    if (exists.data) return filesFailure("FILES_ALREADY_EXISTS");
    const preparedId = remember({
      type: "CREATE_FOLDER",
      root,
      parent,
      name,
      expiresAt: dependencies.now() + PREPARED_ACTION_LIFETIME_MS
    });
    return filesSuccess({ preparedId, folderName: name, locationLabel });
  };

  const commitCreateFolder: SupervisedFileService["commitCreateFolder"] = async (preparedId) => {
    const pending = takePrepared(preparedId, "CREATE_FOLDER");
    if (!pending) return filesFailure("FILES_STALE_SELECTION");
    const name = validateFolderName(pending.name);
    if (!name) return filesFailure("FILES_INVALID_NAME");
    const valid = await revalidateParent(pending.parent, pending.root);
    if (!valid.ok) return valid;
    const target = path.join(pending.parent.path, name);
    const exists = await targetExists(target);
    if (!exists.ok) return exists;
    if (exists.data) return filesFailure("FILES_ALREADY_EXISTS");
    try {
      // Non-recursive: the parent must already exist, and an existing target is never merged.
      await filesystem.mkdir(target);
      return filesSuccess({ created: true });
    } catch (error) {
      if (errorCodeOf(error) === "EEXIST") return filesFailure("FILES_ALREADY_EXISTS");
      dependencies.logError("Supervised folder creation failed.");
      return filesFailure("FILES_OPERATION_FAILED");
    }
  };

  // ---- supervised mutations: rename, move, organize, delete (Recycle Bin only)

  const selectEntries = (input: { ordinals?: unknown; all?: unknown }): FilesResult<FoundEntry[]> => {
    const selection = parseSelection(input);
    if (!selection) return filesFailure("FILES_STALE_SELECTION");
    const active = activeEntries();
    if ("all" in selection) {
      return active.length > 0 ? filesSuccess(active.map((entry) => ({ ...entry }))) : filesFailure("FILES_STALE_SELECTION");
    }
    const picked: FoundEntry[] = [];
    for (const ordinal of selection.ordinals) {
      const entry = active.find((candidate) => candidate.ordinal === ordinal);
      if (!entry) return filesFailure("FILES_STALE_SELECTION");
      picked.push({ ...entry });
    }
    return filesSuccess(picked);
  };

  const revalidateAll = async (entries: FoundEntry[], missingCode: FilesFailureCode): Promise<FilesResult<true>> => {
    for (const entry of entries) {
      const valid = await revalidateEntry(entry, missingCode);
      if (!valid.ok) return valid;
    }
    return filesSuccess(true);
  };

  /** A destination must be a real directory (not a symlink or junction) that is the approved root itself. */
  const revalidateRootDestination = async (destination: MoveDestination): Promise<FilesResult<true>> => {
    const base = await resolveRoot(destination.root);
    if (!base || !samePath(base, destination.path)) return filesFailure("FILES_OUT_OF_SCOPE");
    try {
      const stats = await filesystem.lstat(destination.path);
      return stats.isDirectory() && !stats.isSymbolicLink() ? filesSuccess(true) : filesFailure("FILES_DESTINATION_INVALID");
    } catch {
      return filesFailure("FILES_DESTINATION_INVALID");
    }
  };

  const revalidateDestination = (destination: MoveDestination): Promise<FilesResult<true>> =>
    destination.entry ? revalidateEntry(destination.entry, "FILES_DESTINATION_INVALID") : revalidateRootDestination(destination);

  /** Aborts the whole request before anything moves: self/descendant moves, duplicate names, and collisions. */
  const planMoveInto = async (
    destinationPath: string,
    entries: FoundEntry[],
    destinationExists: boolean
  ): Promise<FilesResult<true>> => {
    const names = new Set<string>();
    for (const entry of entries) {
      if (entry.kind === "FOLDER" && (samePath(destinationPath, entry.absolutePath) || isInside(destinationPath, entry.absolutePath))) {
        return filesFailure("FILES_DESTINATION_INVALID");
      }
      const key = entry.name.toLocaleLowerCase("en-US");
      if (names.has(key)) return filesFailure("FILES_ALREADY_EXISTS");
      names.add(key);
      if (destinationExists) {
        const exists = await targetExists(path.join(destinationPath, entry.name));
        if (!exists.ok) return exists;
        if (exists.data) return filesFailure("FILES_ALREADY_EXISTS");
      }
    }
    return filesSuccess(true);
  };

  /** Sequential single-entry renames only. A mid-way failure stops and reports counts, never names. */
  const moveSequentially = async (entries: FoundEntry[], destinationPath: string): Promise<FilesResult<SupervisedFileMutationData>> => {
    let moved = 0;
    for (const entry of entries) {
      const target = path.join(destinationPath, entry.name);
      let failed = false;
      try {
        const exists = await targetExists(target);
        if (!exists.ok || exists.data) failed = true;
        else await filesystem.rename(entry.absolutePath, target);
      } catch {
        // EXDEV (another volume) and every other error are the same controlled failure: no copy fallback exists.
        failed = true;
      }
      if (failed) {
        dependencies.logError("Supervised file move stopped.");
        invalidateSearch();
        return filesFailure(moved === 0 ? "FILES_OPERATION_FAILED" : "FILES_PARTIAL_COMPLETION", {
          moved,
          failed: entries.length - moved
        });
      }
      moved += 1;
    }
    invalidateSearch();
    return filesSuccess({ movedCount: moved, failedCount: 0 });
  };

  const prepareRename: SupervisedFileService["prepareRename"] = async (input) => {
    if (!isRecord(input) || !hasOnlyKeys(input, ["ordinal", "newName"])) return filesFailure("FILES_INVALID_NAME");
    const entry = getFoundEntry(input.ordinal);
    if (!entry) return filesFailure("FILES_STALE_SELECTION");
    const requested = validateFolderName(input.newName);
    if (!requested) return filesFailure("FILES_INVALID_NAME");
    const finalName = validateFolderName(computeRenamedName(entry.name, entry.kind, requested));
    if (!finalName) return filesFailure("FILES_INVALID_NAME");
    if (hasBlockedExtension(finalName)) return filesFailure("FILES_TYPE_BLOCKED");
    const valid = await revalidateEntry(entry, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;
    const planned = await planRename(entry, finalName);
    if (!planned.ok) return planned;
    const preparedId = remember({
      type: "RENAME",
      entry: { ...entry },
      finalName,
      expiresAt: dependencies.now() + PREPARED_ACTION_LIFETIME_MS
    });
    return filesSuccess({
      preparedId,
      currentName: entry.name,
      newName: finalName,
      kind: entry.kind,
      rootLabel: SUPERVISED_FILE_ROOT_LABELS[entry.root]
    });
  };

  /** Same parent only; never overwrites. A case-only change of the same entry is the one allowed "collision". */
  const planRename = async (entry: FoundEntry, finalName: string): Promise<FilesResult<true>> => {
    const root = await resolveRoot(entry.root);
    if (!root) return filesFailure("FILES_OUT_OF_SCOPE");
    const target = path.join(path.dirname(entry.absolutePath), finalName);
    if (!isInside(target, root)) return filesFailure("FILES_OUT_OF_SCOPE");
    if (samePath(target, entry.absolutePath)) {
      return finalName === entry.name ? filesFailure("FILES_ALREADY_EXISTS") : filesSuccess(true);
    }
    const exists = await targetExists(target);
    if (!exists.ok) return exists;
    return exists.data ? filesFailure("FILES_ALREADY_EXISTS") : filesSuccess(true);
  };

  const applyRenameToSearch = (entry: FoundEntry, finalName: string, newPath: string): void => {
    if (!lastSearch) return;
    for (const candidate of lastSearch.entries) {
      if (candidate.ordinal === entry.ordinal) {
        candidate.name = finalName;
        candidate.absolutePath = newPath;
        candidate.kind = classifyEntry(finalName, entry.kind === "FOLDER");
      } else if (entry.kind === "FOLDER" && isInside(candidate.absolutePath, entry.absolutePath)) {
        candidate.absolutePath = path.join(newPath, path.relative(entry.absolutePath, candidate.absolutePath));
      }
    }
  };

  const commitRename: SupervisedFileService["commitRename"] = async (preparedId) => {
    const pending = takePrepared(preparedId, "RENAME");
    if (!pending) return filesFailure("FILES_STALE_SELECTION");
    const valid = await revalidateEntry(pending.entry, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;
    const planned = await planRename(pending.entry, pending.finalName);
    if (!planned.ok) return planned;
    const target = path.join(path.dirname(pending.entry.absolutePath), pending.finalName);
    try {
      await filesystem.rename(pending.entry.absolutePath, target);
    } catch (error) {
      if (errorCodeOf(error) !== "ENOENT") dependencies.logError("Supervised file rename failed.");
      return filesFailure(errorCodeOf(error) === "ENOENT" ? "FILES_TARGET_NOT_FOUND" : "FILES_OPERATION_FAILED");
    }
    applyRenameToSearch(pending.entry, pending.finalName, target);
    return filesSuccess({ renamed: true });
  };

  const prepareMove: SupervisedFileService["prepareMove"] = async (input) => {
    if (!isRecord(input) || !hasOnlyKeys(input, ["ordinals", "all", "destinationRoot", "destinationOrdinal"])) {
      return filesFailure("FILES_DESTINATION_INVALID");
    }
    const selected = selectEntries(input);
    if (!selected.ok) return selected;
    const valid = await revalidateAll(selected.data, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;

    const hasRoot = input.destinationRoot !== undefined;
    const hasOrdinal = input.destinationOrdinal !== undefined;
    if (hasRoot === hasOrdinal && !(hasRoot && hasOrdinal)) return filesFailure("FILES_DESTINATION_INVALID");
    let destination: MoveDestination;
    if (hasOrdinal) {
      const folder = getFoundEntry(input.destinationOrdinal);
      if (!folder) return filesFailure("FILES_STALE_SELECTION");
      if (folder.kind !== "FOLDER") return filesFailure("FILES_DESTINATION_INVALID");
      if (hasRoot && input.destinationRoot !== folder.root) return filesFailure("FILES_DESTINATION_INVALID");
      const folderValid = await revalidateEntry(folder, "FILES_DESTINATION_INVALID");
      if (!folderValid.ok) return folderValid;
      destination = { path: folder.absolutePath, root: folder.root, entry: { ...folder } };
    } else {
      if (!isSupervisedFileRoot(input.destinationRoot)) return filesFailure("FILES_OUT_OF_SCOPE");
      const base = await resolveRoot(input.destinationRoot);
      if (!base) return filesFailure("FILES_OUT_OF_SCOPE");
      destination = { path: base, root: input.destinationRoot };
    }
    const destinationValid = await revalidateDestination(destination);
    if (!destinationValid.ok) return destinationValid;
    const planned = await planMoveInto(destination.path, selected.data, true);
    if (!planned.ok) return planned;

    const preparedId = remember({
      type: "MOVE",
      entries: selected.data,
      destination,
      expiresAt: dependencies.now() + PREPARED_ACTION_LIFETIME_MS
    });
    const rootLabel = SUPERVISED_FILE_ROOT_LABELS[destination.root];
    return filesSuccess({
      preparedId,
      itemCount: selected.data.length,
      destinationLabel: destination.entry ? `${destination.entry.name} (${rootLabel})` : rootLabel
    });
  };

  const commitMove: SupervisedFileService["commitMove"] = async (preparedId) => {
    const pending = takePrepared(preparedId, "MOVE");
    if (!pending) return filesFailure("FILES_STALE_SELECTION");
    const destinationValid = await revalidateDestination(pending.destination);
    if (!destinationValid.ok) return destinationValid;
    const valid = await revalidateAll(pending.entries, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;
    const planned = await planMoveInto(pending.destination.path, pending.entries, true);
    if (!planned.ok) return planned;
    return moveSequentially(pending.entries, pending.destination.path);
  };

  const prepareOrganize: SupervisedFileService["prepareOrganize"] = async (input) => {
    if (!isRecord(input) || !hasOnlyKeys(input, ["ordinals", "all", "folderName", "root"])) {
      return filesFailure("FILES_INVALID_NAME");
    }
    const folderName = validateFolderName(input.folderName);
    if (!folderName) return filesFailure("FILES_INVALID_NAME");
    if (!isSupervisedFileRoot(input.root)) return filesFailure("FILES_OUT_OF_SCOPE");
    const selected = selectEntries(input);
    if (!selected.ok) return selected;
    const valid = await revalidateAll(selected.data, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;

    const base = await resolveRoot(input.root);
    if (!base) return filesFailure("FILES_OUT_OF_SCOPE");
    const folderPath = path.join(base, folderName);
    const existing = await inspectOrganizeFolder(folderPath, base);
    if (!existing.ok) return existing;
    const planned = await planMoveInto(folderPath, selected.data, existing.data === "EXISTS");
    if (!planned.ok) return planned;

    const preparedId = remember({
      type: "ORGANIZE",
      entries: selected.data,
      root: input.root,
      folderName,
      folderPath,
      createFolder: existing.data === "MISSING",
      expiresAt: dependencies.now() + PREPARED_ACTION_LIFETIME_MS
    });
    return filesSuccess({
      preparedId,
      itemCount: selected.data.length,
      folderName,
      createFolder: existing.data === "MISSING",
      destinationLabel: SUPERVISED_FILE_ROOT_LABELS[input.root]
    });
  };

  /** An existing destination must be a real directory inside the root; a missing one will be created. */
  const inspectOrganizeFolder = async (folderPath: string, base: string): Promise<FilesResult<"EXISTS" | "MISSING">> => {
    try {
      const stats = await filesystem.lstat(folderPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return filesFailure("FILES_DESTINATION_INVALID");
      const real = await filesystem.realpath(folderPath);
      if (!isInside(real, base) || !samePath(real, folderPath)) return filesFailure("FILES_DESTINATION_INVALID");
      return filesSuccess("EXISTS");
    } catch (error) {
      if (errorCodeOf(error) === "ENOENT") return filesSuccess("MISSING");
      dependencies.logError("Supervised organize destination inspection failed.");
      return filesFailure("FILES_OPERATION_FAILED");
    }
  };

  const commitOrganize: SupervisedFileService["commitOrganize"] = async (preparedId) => {
    const pending = takePrepared(preparedId, "ORGANIZE");
    if (!pending) return filesFailure("FILES_STALE_SELECTION");
    const name = validateFolderName(pending.folderName);
    if (!name) return filesFailure("FILES_INVALID_NAME");
    const base = await resolveRoot(pending.root);
    if (!base) return filesFailure("FILES_OUT_OF_SCOPE");
    const valid = await revalidateAll(pending.entries, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;
    const state = await inspectOrganizeFolder(pending.folderPath, base);
    if (!state.ok) return state;
    // The confirmed operation is exactly what was reviewed: a folder that appeared or vanished aborts it.
    if (pending.createFolder && state.data === "EXISTS") return filesFailure("FILES_ALREADY_EXISTS");
    if (!pending.createFolder && state.data === "MISSING") return filesFailure("FILES_STALE_SELECTION");
    const planned = await planMoveInto(pending.folderPath, pending.entries, state.data === "EXISTS");
    if (!planned.ok) return planned;
    if (pending.createFolder) {
      try {
        await filesystem.mkdir(pending.folderPath);
      } catch (error) {
        if (errorCodeOf(error) === "EEXIST") return filesFailure("FILES_ALREADY_EXISTS");
        dependencies.logError("Supervised organize folder creation failed.");
        return filesFailure("FILES_OPERATION_FAILED");
      }
    }
    return moveSequentially(pending.entries, pending.folderPath);
  };

  const prepareDelete: SupervisedFileService["prepareDelete"] = async (ordinal) => {
    const entry = getFoundEntry(ordinal);
    if (!entry) return filesFailure("FILES_STALE_SELECTION");
    const valid = await revalidateEntry(entry, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;
    const preparedId = remember({
      type: "DELETE",
      entry: { ...entry },
      expiresAt: dependencies.now() + PREPARED_ACTION_LIFETIME_MS
    });
    return filesSuccess({
      preparedId,
      displayName: entry.name,
      kind: entry.kind,
      rootLabel: SUPERVISED_FILE_ROOT_LABELS[entry.root]
    });
  };

  const commitDelete: SupervisedFileService["commitDelete"] = async (preparedId) => {
    const pending = takePrepared(preparedId, "DELETE");
    if (!pending) return filesFailure("FILES_STALE_SELECTION");
    const valid = await revalidateEntry(pending.entry, "FILES_TARGET_NOT_FOUND");
    if (!valid.ok) return valid;
    try {
      // The Recycle Bin is the only removal path. If it fails, nothing is deleted and nothing else is tried.
      await shell.trashItem(pending.entry.absolutePath);
    } catch {
      dependencies.logError("Supervised file Recycle Bin operation failed.");
      return filesFailure("FILES_RECYCLE_UNAVAILABLE");
    }
    invalidateSearch();
    return filesSuccess({ trashed: true });
  };

  return {
    getActiveSearchInfo,
    resolveFoundFileByName,
    resolveFoundFolderByName,
    search,
    revealFound,
    prepareOpen,
    commitOpen,
    prepareCreateFolder,
    commitCreateFolder,
    prepareRename,
    commitRename,
    prepareMove,
    commitMove,
    prepareOrganize,
    commitOrganize,
    prepareDelete,
    commitDelete
  };
};
