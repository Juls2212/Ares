import type { OperationResult } from "./contracts";

export const APPLICATION_PLATFORMS = ["WINDOWS", "MACOS", "LINUX"] as const;

export const APPLICATION_LAUNCH_MODES = [
  "WINDOWS_EXECUTABLE",
  "CATALOG_APPLICATION"
] as const;

/**
 * Closed catalog identifiers. This list is the single source for the type, the database enum,
 * and the structured-output schema; each key must also have one declarative entry in the Main catalog.
 */
export const APPLICATION_CATALOG_KEYS = [
  "GOOGLE_CHROME",
  "MICROSOFT_EDGE",
  "MOZILLA_FIREFOX",
  "SPOTIFY",
  "WHATSAPP",
  "MICROSOFT_WORD",
  "VISUAL_STUDIO_CODE",
  "DISCORD",
  "CLAUDE"
] as const;

export type ApplicationPlatform = (typeof APPLICATION_PLATFORMS)[number];
export type ApplicationLaunchMode = (typeof APPLICATION_LAUNCH_MODES)[number];
export type ApplicationCatalogKey = (typeof APPLICATION_CATALOG_KEYS)[number];
export type IsoDateTime = string;

export type ApplicationAliasRecord = {
  id: string;
  applicationId: string;
  alias: string;
  createdAt: IsoDateTime;
};

export type ApplicationRecord = {
  id: string;
  name: string;
  platform: ApplicationPlatform;
  launchMode: ApplicationLaunchMode;
  catalogKey: ApplicationCatalogKey | null;
  isFavorite: boolean;
  isEnabled: boolean;
  lastLaunchedAt: IsoDateTime | null;
  aliases: ApplicationAliasRecord[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

type ApplicationRegistrationBase = {
  name: string;
  aliases: string[];
  isFavorite?: boolean;
  isEnabled?: boolean;
};

/** Legacy registrations remain restricted to a validated absolute Windows executable. */
export type RegisterWindowsExecutableApplicationInput = ApplicationRegistrationBase & {
  executablePath: string;
  platform?: "WINDOWS";
  launchMode?: "WINDOWS_EXECUTABLE";
  catalogKey?: never;
};

/** Catalog registrations persist no path, command, protocol, or launch arguments. */
export type RegisterCatalogApplicationTargetInput = ApplicationRegistrationBase & {
  platform: ApplicationPlatform;
  launchMode: "CATALOG_APPLICATION";
  catalogKey: ApplicationCatalogKey;
  executablePath?: never;
};

export type RegisterApplicationInput =
  | RegisterWindowsExecutableApplicationInput
  | RegisterCatalogApplicationTargetInput;

export type UpdateApplicationInput = {
  applicationId: string;
  name?: string;
  executablePath?: string;
  aliases?: string[];
  isFavorite?: boolean;
  isEnabled?: boolean;
};

export type ApplicationListInput = {
  enabled?: boolean;
  favorite?: boolean;
  limit?: number;
};

export type ApplicationMutationData = {
  record: ApplicationRecord;
};

export type ApplicationListData = {
  items: ApplicationRecord[];
  total: number;
};

export const REGISTERABLE_CATALOG_APPLICATIONS = [
  "GOOGLE_CHROME",
  "VISUAL_STUDIO_CODE",
  "VISUAL_STUDIO",
  "SPOTIFY"
] as const;

export type RegisterableCatalogApplication =
  (typeof REGISTERABLE_CATALOG_APPLICATIONS)[number];

export type RegisterCatalogApplicationInput = {
  application: RegisterableCatalogApplication;
};

export type RegisterCustomApplicationInput = {
  displayName: string;
};

/** Result of a fixed Main-owned catalog registration; it never includes a path. */
export type CatalogApplicationRegistrationData =
  | {
      status: "REGISTERED" | "ALREADY_REGISTERED";
      application: RegisterableCatalogApplication;
      record: ApplicationRecord;
    }
  | { status: "CANCELLED"; application: RegisterableCatalogApplication };

/** Safe status only; custom registration never returns IDs or filesystem details. */
export type CustomApplicationRegistrationData = {
  status: "REGISTERED" | "ALREADY_REGISTERED" | "CANCELLED";
};

export const APPLICATION_ERROR_CODES = {
  inputInvalid: "APPLICATION_INPUT_INVALID",
  unknownField: "APPLICATION_UNKNOWN_FIELD",
  requiredFieldMissing: "APPLICATION_REQUIRED_FIELD_MISSING",
  fieldTypeInvalid: "APPLICATION_FIELD_TYPE_INVALID",
  textInvalid: "APPLICATION_TEXT_INVALID",
  textTooLong: "APPLICATION_TEXT_TOO_LONG",
  identifierInvalid: "APPLICATION_IDENTIFIER_INVALID",
  platformInvalid: "APPLICATION_PLATFORM_INVALID",
  launchModeInvalid: "APPLICATION_LAUNCH_MODE_INVALID",
  catalogKeyInvalid: "APPLICATION_CATALOG_KEY_INVALID",
  executablePathInvalid: "APPLICATION_EXECUTABLE_PATH_INVALID",
  executableNotFound: "APPLICATION_EXECUTABLE_NOT_FOUND",
  executableNotFile: "APPLICATION_EXECUTABLE_NOT_FILE",
  executableExtensionInvalid: "APPLICATION_EXECUTABLE_EXTENSION_INVALID",
  launchFailed: "APPLICATION_LAUNCH_FAILED",
  duplicateAlias: "APPLICATION_DUPLICATE_ALIAS",
  updateEmpty: "APPLICATION_UPDATE_EMPTY",
  notFound: "APPLICATION_NOT_FOUND",
  disabled: "APPLICATION_DISABLED",
  conflict: "APPLICATION_CONFLICT",
  databaseUnavailable: "APPLICATION_DATABASE_UNAVAILABLE",
  ipcUnavailable: "APPLICATION_IPC_UNAVAILABLE",
  catalogSelectionInvalid: "APPLICATION_CATALOG_SELECTION_INVALID",
  catalogPickerUnavailable: "APPLICATION_CATALOG_PICKER_UNAVAILABLE",
  customSelectionInvalid: "APPLICATION_CUSTOM_SELECTION_INVALID",
  customPickerUnavailable: "APPLICATION_CUSTOM_PICKER_UNAVAILABLE",
  customConfirmationUnavailable: "APPLICATION_CUSTOM_CONFIRMATION_UNAVAILABLE",
  customRegistrationCancelled: "APPLICATION_CUSTOM_REGISTRATION_CANCELLED"
} as const;

export type ApplicationErrorCode =
  (typeof APPLICATION_ERROR_CODES)[keyof typeof APPLICATION_ERROR_CODES];

export type ApplicationOperationResult<T> = OperationResult<T>;

export type ApplicationsApi = {
  /** Opens a Main-owned native picker for one fixed catalog application only. */
  registerCatalogApplication: (
    input: RegisterCatalogApplicationInput
  ) => Promise<ApplicationOperationResult<CatalogApplicationRegistrationData>>;
  registerCustomApplication: (
    input: RegisterCustomApplicationInput
  ) => Promise<ApplicationOperationResult<CustomApplicationRegistrationData>>;
  list: (input: ApplicationListInput) => Promise<ApplicationOperationResult<ApplicationListData>>;
  update: (
    input: UpdateApplicationInput
  ) => Promise<ApplicationOperationResult<ApplicationMutationData>>;
};
