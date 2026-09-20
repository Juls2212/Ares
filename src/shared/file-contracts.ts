import type { OperationResult } from "./contracts";

export const APPROVED_FILE_ROOTS = ["DOCUMENTS", "DOWNLOADS", "DESKTOP"] as const;

export type ApprovedFileRoot = (typeof APPROVED_FILE_ROOTS)[number];

export const FILE_ENTRY_TYPES = ["FILE", "DIRECTORY"] as const;

export type FileEntryType = (typeof FILE_ENTRY_TYPES)[number];

export type SafeFileReference = {
  rootId: ApprovedFileRoot;
  relativePath: string;
};

export type SafeFileSearchResult = SafeFileReference & {
  name: string;
  entryType: FileEntryType;
  extension: string | null;
  size: number | null;
  lastModified: string | null;
};

export type FileSearchInput = {
  rootId: ApprovedFileRoot;
  query: string;
  extensions?: string[];
  relativePath?: string;
  limit?: number;
};

export type FileSearchData = {
  items: SafeFileSearchResult[];
  total: number;
  truncated: boolean;
  skippedEntryCount: number;
};

export type CreateFolderInput = {
  parentDirectory: SafeFileReference;
  name: string;
};

export type RenameFileInput = {
  source: SafeFileReference;
  newName: string;
};

export type RenameFolderInput = {
  source: SafeFileReference;
  newName: string;
};

export type MoveFileInput = {
  source: SafeFileReference;
  destinationDirectory: SafeFileReference;
};

export const ORGANIZATION_CATEGORIES = [
  "DOCUMENTS",
  "IMAGES",
  "AUDIO",
  "VIDEOS",
  "ARCHIVES",
  "OTHER"
] as const;

export type OrganizationCategory = (typeof ORGANIZATION_CATEGORIES)[number];

export const ORGANIZATION_SKIP_REASONS = [
  "EXCLUDED",
  "DIRECTORY",
  "REPARSE_POINT",
  "UNSAFE_ENTRY",
  "ALREADY_CATEGORY_FOLDER",
  "DESTINATION_CONFLICT",
  "SOURCE_UNAVAILABLE",
  "DESTINATION_UNAVAILABLE",
  "MOVE_FAILED"
] as const;

export type OrganizationSkipReason = (typeof ORGANIZATION_SKIP_REASONS)[number];

export type OrganizeFilesInput = {
  folder: SafeFileReference;
  exclusions?: SafeFileReference[];
};

export type OrganizationCategoryCounts = Record<OrganizationCategory, number>;

export type OrganizationPlanItem = {
  source: SafeFileReference;
  destination: SafeFileReference;
  category: OrganizationCategory;
};

export type OrganizationSkipCount = {
  reason: OrganizationSkipReason;
  count: number;
};

/** A read-only, Main-generated preview. It never contains canonical paths. */
export type FileOrganizationPlan = {
  rootId: ApprovedFileRoot;
  folder: SafeFileReference;
  items: OrganizationPlanItem[];
  plannedCount: number;
  skippedCount: number;
  conflictCount: number;
  categoryCounts: OrganizationCategoryCounts;
  skipped: OrganizationSkipCount[];
  mixedContent: boolean;
  empty: boolean;
};

export type FileOrganizationExecutionData = {
  plannedCount: number;
  movedCount: number;
  skippedCount: number;
  conflictCount: number;
  partial: boolean;
  categoryCounts: OrganizationCategoryCounts;
};

export type FileMutationOperation =
  | "CREATE_FOLDER"
  | "RENAME_FILE"
  | "RENAME_FOLDER"
  | "MOVE_FILE";

export type SafeFileMutationRecord = {
  operation: FileMutationOperation;
  entryType: FileEntryType;
  reference: SafeFileReference;
};

export const FILE_ERROR_CODES = {
  inputInvalid: "FILE_INPUT_INVALID",
  unknownField: "FILE_UNKNOWN_FIELD",
  rootInvalid: "FILE_ROOT_INVALID",
  queryInvalid: "FILE_QUERY_INVALID",
  extensionInvalid: "FILE_EXTENSION_INVALID",
  relativePathInvalid: "FILE_RELATIVE_PATH_INVALID",
  limitInvalid: "FILE_LIMIT_INVALID",
  rootUnavailable: "FILE_ROOT_UNAVAILABLE",
  searchScopeUnavailable: "FILE_SEARCH_SCOPE_UNAVAILABLE",
  searchUnavailable: "FILE_SEARCH_UNAVAILABLE",
  nameInvalid: "FILE_NAME_INVALID",
  nameReserved: "FILE_NAME_RESERVED",
  sourceNotFound: "FILE_SOURCE_NOT_FOUND",
  destinationNotFound: "FILE_DESTINATION_NOT_FOUND",
  sourceTypeInvalid: "FILE_SOURCE_TYPE_INVALID",
  destinationTypeInvalid: "FILE_DESTINATION_TYPE_INVALID",
  reparsePointRejected: "FILE_REPARSE_POINT_REJECTED",
  collision: "FILE_COLLISION",
  noOp: "FILE_NO_OP",
  crossVolumeUnsupported: "FILE_CROSS_VOLUME_UNSUPPORTED",
  nativeMoveUnavailable: "FILE_NATIVE_MOVE_UNAVAILABLE",
  mutationFailed: "FILE_MUTATION_FAILED",
  organizationUnavailable: "FILE_ORGANIZATION_UNAVAILABLE"
} as const;

export type FileErrorCode = (typeof FILE_ERROR_CODES)[keyof typeof FILE_ERROR_CODES];

export type FileOperationResult<T> = OperationResult<T>;
