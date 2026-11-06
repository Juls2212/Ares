import {
  FILE_SEARCH_KINDS,
  MAX_FOUND_ORDINAL,
  SUPERVISED_FILE_ROOTS,
  type FileSearchKind,
  type FoundEntryKind,
  type SupervisedFileRoot
} from "../../shared/supervised-file-contracts";

export const MAX_QUERY_LENGTH = 64;
export const MAX_FOLDER_NAME_LENGTH = 64;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const QUERY_FORBIDDEN_CHARACTERS = /[\\/:*?"<>|]/u;
const FOLDER_FORBIDDEN_CHARACTERS = /[<>:"/\\|?*]/u;
const RESERVED_DEVICE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/** Lowercases and strips diacritics so matching is case- and accent-insensitive. */
export const normalizeForMatching = (value: string): string =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US");

export const isSupervisedFileRoot = (value: unknown): value is SupervisedFileRoot =>
  typeof value === "string" && (SUPERVISED_FILE_ROOTS as readonly string[]).includes(value);

export const isFileSearchKind = (value: unknown): value is FileSearchKind =>
  typeof value === "string" && (FILE_SEARCH_KINDS as readonly string[]).includes(value);

export const isFoundOrdinal = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_FOUND_ORDINAL;

/** A search query is a short entry-name fragment: never a path, URL, scheme, or wildcard. */
export const validateSearchQuery = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const query = value.trim();
  if (query.length === 0 || query.length > MAX_QUERY_LENGTH) return undefined;
  if (CONTROL_CHARACTERS.test(query) || QUERY_FORBIDDEN_CHARACTERS.test(query)) return undefined;
  if (query.includes("..") || query.startsWith("~") || /^www\./iu.test(query)) return undefined;
  return normalizeForMatching(query).trim().length === 0 ? undefined : query;
};

/** A folder name is exactly one valid Windows path segment. */
export const validateFolderName = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_FOLDER_NAME_LENGTH) return undefined;
  if (name === "." || name === ".." || name.includes("..")) return undefined;
  if (CONTROL_CHARACTERS.test(name) || FOLDER_FORBIDDEN_CHARACTERS.test(name)) return undefined;
  if (name.endsWith(".") || name.endsWith(" ")) return undefined;
  // A reserved device name is reserved with or without an extension (for example "CON.txt").
  if (RESERVED_DEVICE_NAMES.test(name.split(".")[0] ?? "")) return undefined;
  return name;
};

const extensionSets: Readonly<Record<Exclude<FoundEntryKind, "FOLDER" | "OTHER">, ReadonlySet<string>>> = {
  DOCUMENT: new Set([
    ".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".md", ".xls", ".xlsx", ".ods", ".csv",
    ".ppt", ".pptx", ".odp", ".epub"
  ]),
  IMAGE: new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".svg"]),
  AUDIO: new Set([".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".wma", ".opus"]),
  VIDEO: new Set([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".flv"])
};

export const extensionOf = (name: string): string => {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index).toLocaleLowerCase("en-US");
};

export const classifyEntry = (name: string, isDirectory: boolean): FoundEntryKind => {
  if (isDirectory) return "FOLDER";
  const extension = extensionOf(name);
  for (const kind of ["DOCUMENT", "IMAGE", "AUDIO", "VIDEO"] as const) {
    if (extensionSets[kind].has(extension)) return kind;
  }
  return "OTHER";
};

export const matchesKind = (filter: FileSearchKind, entryKind: FoundEntryKind): boolean =>
  filter === "ANY" || filter === entryKind;

/** Closed blocklist: these types are never opened, and a file with no extension is never opened. */
export const BLOCKED_OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".msi", ".msp",
  ".scr", ".lnk", ".url", ".reg", ".hta", ".jar", ".dll", ".cpl", ".appx", ".msix"
]);

export const isOpenBlocked = (name: string): boolean => {
  const extension = extensionOf(name);
  return extension === "" || BLOCKED_OPEN_EXTENSIONS.has(extension);
};

/** Entries the walk never reports or enters: hidden-by-convention, system files, and noise folders. */
const NOISE_NAMES: ReadonlySet<string> = new Set([
  "node_modules", ".git", "appdata", "desktop.ini", "thumbs.db", "system volume information", "$recycle.bin"
]);

export const isSkippedEntryName = (name: string): boolean =>
  name.startsWith(".") || name.startsWith("$") || NOISE_NAMES.has(name.toLocaleLowerCase("en-US"));

/** True when the name's final extension is on the open blocklist, whatever the entry was before. */
export const hasBlockedExtension = (name: string): boolean => BLOCKED_OPEN_EXTENSIONS.has(extensionOf(name));

// A supplied extension must contain a letter, so «v2.0» keeps the original extension while «.pdf» replaces it.
const SUPPLIED_EXTENSION = /^\.(?=[^.]*[a-z])[a-z0-9]{1,8}$/iu;

/**
 * Files keep their original extension unless the new name supplies one. Folders use the name as given.
 * The result still has to pass the single-segment name rules and must not be on the blocklist.
 */
export const computeRenamedName = (originalName: string, kind: FoundEntryKind, newName: string): string => {
  if (kind === "FOLDER") return newName;
  if (SUPPLIED_EXTENSION.test(extensionOf(newName))) return newName;
  return `${newName}${extensionOf(originalName)}`;
};

/** A selection is 1..10 distinct ordinals, or the closed "all current results" flag, never both. */
export const parseSelection = (
  input: { ordinals?: unknown; all?: unknown }
): { all: true } | { ordinals: number[] } | undefined => {
  const hasOrdinals = input.ordinals !== undefined;
  const hasAll = input.all !== undefined;
  if (hasOrdinals === hasAll) return undefined;
  if (hasAll) return input.all === true ? { all: true } : undefined;
  if (!Array.isArray(input.ordinals) || input.ordinals.length < 1 || input.ordinals.length > MAX_FOUND_ORDINAL) return undefined;
  if (!input.ordinals.every(isFoundOrdinal)) return undefined;
  const unique = [...new Set(input.ordinals as number[])];
  return unique.length === input.ordinals.length ? { ordinals: unique } : undefined;
};
