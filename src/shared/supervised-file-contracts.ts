/**
 * Contracts for the supervised FILES domain. Nothing here carries a filesystem path:
 * the renderer and provider only ever see enum values, ordinals, and display strings.
 */
export const SUPERVISED_FILE_ROOTS = ["DESKTOP", "DOCUMENTS", "DOWNLOADS", "PICTURES", "MUSIC", "VIDEOS"] as const;
export type SupervisedFileRoot = (typeof SUPERVISED_FILE_ROOTS)[number];

export const SUPERVISED_FILE_ROOT_LABELS: Readonly<Record<SupervisedFileRoot, string>> = Object.freeze({
  DESKTOP: "Escritorio",
  DOCUMENTS: "Documentos",
  DOWNLOADS: "Descargas",
  PICTURES: "Imágenes",
  MUSIC: "Música",
  VIDEOS: "Videos"
});

export const FILE_SEARCH_KINDS = ["DOCUMENT", "IMAGE", "AUDIO", "VIDEO", "FOLDER", "ANY"] as const;
export type FileSearchKind = (typeof FILE_SEARCH_KINDS)[number];

export const FOUND_ENTRY_KINDS = ["DOCUMENT", "IMAGE", "AUDIO", "VIDEO", "FOLDER", "OTHER"] as const;
export type FoundEntryKind = (typeof FOUND_ENTRY_KINDS)[number];

export const MAX_FOUND_ORDINAL = 10;

export type SearchFilesInput = {
  query: string;
  root?: SupervisedFileRoot;
  kind?: FileSearchKind;
};

export type RevealFoundFileInput = {
  ordinal: number;
};

/** The opaque preparation reference is generated in Main only and never accepted from a caller. */
export type OpenFoundFileInput = {
  ordinal: number;
  preparedId?: string;
};

export type CreateSupervisedFolderInput = {
  folderName: string;
  root?: SupervisedFileRoot;
  parentOrdinal?: number;
  preparedId?: string;
};

/** The only per-result data that leaves Main. */
export type FoundFileSummary = {
  ordinal: number;
  name: string;
  kind: FoundEntryKind;
  rootLabel: string;
};

export type SupervisedFileSearchData = {
  resultCount: number;
  partial: boolean;
  items: FoundFileSummary[];
};

/** Rename keeps the entry in its folder; the new name is a single validated segment. */
export type RenameFoundItemInput = {
  ordinal: number;
  newName: string;
  preparedId?: string;
};

/** Exactly one of `ordinals` or `all`, and exactly one of `destinationRoot` or `destinationOrdinal`. */
export type MoveFoundItemsInput = {
  ordinals?: number[];
  all?: true;
  destinationRoot?: SupervisedFileRoot;
  destinationOrdinal?: number;
  preparedId?: string;
};

/** Moves the selected results into a named folder inside an approved root, creating it when missing. */
export type OrganizeFoundItemsInput = {
  ordinals?: number[];
  all?: true;
  folderName: string;
  root: SupervisedFileRoot;
  preparedId?: string;
};

/** Deletion accepts exactly one ordinal per request and only ever goes to the Recycle Bin. */
export type DeleteFoundItemInput = {
  ordinal: number;
  preparedId?: string;
};

/** Counts only: no names and no paths. */
export type SupervisedFileMutationData = {
  movedCount: number;
  failedCount: number;
};
