import {
  APPLICATION_ERROR_CODES,
  APPLICATION_PLATFORMS,
  type ApplicationErrorCode,
  type ApplicationListInput,
  type ApplicationOperationResult,
  type ApplicationPlatform,
  type RegisterApplicationInput,
  type UpdateApplicationInput
} from "../../shared/application-contracts";

type InputObject = Record<string, unknown>;

const applicationNameMaximumLength = 160;
const applicationAliasMaximumLength = 160;
const executablePathMaximumLength = 2048;
const applicationAliasMaximumCount = 32;
const applicationListMaximumLimit = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const absoluteWindowsExecutablePattern = /^[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+\.exe$/i;
const unsafeExecutablePathCharacterPattern = /["'%&|;<>()`$!^\r\n]/;

const validationMessages: Record<ApplicationErrorCode, string> = {
  APPLICATION_INPUT_INVALID: "La información de la aplicación no es válida.",
  APPLICATION_UNKNOWN_FIELD: "La solicitud contiene campos no permitidos.",
  APPLICATION_REQUIRED_FIELD_MISSING: "Faltan datos requeridos de la aplicación.",
  APPLICATION_FIELD_TYPE_INVALID: "Uno de los campos de la aplicación tiene un formato no válido.",
  APPLICATION_TEXT_INVALID: "Uno de los textos requeridos no es válido.",
  APPLICATION_TEXT_TOO_LONG: "Uno de los textos supera la longitud permitida.",
  APPLICATION_IDENTIFIER_INVALID: "Uno de los identificadores no es válido.",
  APPLICATION_PLATFORM_INVALID: "La plataforma de la aplicación no es válida.",
  APPLICATION_EXECUTABLE_PATH_INVALID: "La ruta del ejecutable no es válida.",
  APPLICATION_EXECUTABLE_NOT_FOUND: "No se encontró el ejecutable de la aplicación registrada.",
  APPLICATION_EXECUTABLE_NOT_FILE: "El ejecutable registrado no es un archivo válido.",
  APPLICATION_EXECUTABLE_EXTENSION_INVALID: "El archivo registrado no es un ejecutable válido.",
  APPLICATION_LAUNCH_FAILED: "No se pudo abrir la aplicación registrada.",
  APPLICATION_DUPLICATE_ALIAS: "Los alias de la aplicación no pueden repetirse.",
  APPLICATION_UPDATE_EMPTY: "Debes indicar al menos un cambio para actualizar.",
  APPLICATION_NOT_FOUND: "No se encontró la aplicación solicitada.",
  APPLICATION_DISABLED: "La aplicación está deshabilitada.",
  APPLICATION_CONFLICT: "Ya existe una aplicación o alias con esos datos.",
  APPLICATION_DATABASE_UNAVAILABLE: "No se pudo acceder al catálogo de aplicaciones.",
  APPLICATION_IPC_UNAVAILABLE: "No se pudo procesar la solicitud de aplicaciones."
};

const createFailure = <T>(code: ApplicationErrorCode): ApplicationOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: validationMessages[code] }
});

const createSuccess = <T>(data: T): ApplicationOperationResult<T> => ({ ok: true, data });

const hasOwn = (input: InputObject, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(input, key);

const validateObject = (
  input: unknown,
  allowedKeys: readonly string[]
): ApplicationOperationResult<InputObject> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return createFailure(APPLICATION_ERROR_CODES.inputInvalid);
  }

  const record = input as InputObject;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    return createFailure(APPLICATION_ERROR_CODES.unknownField);
  }

  return createSuccess(record);
};

const validateRequiredText = (
  input: InputObject,
  key: string,
  maximumLength: number
): ApplicationOperationResult<string> => {
  if (typeof input[key] !== "string") {
    return createFailure(APPLICATION_ERROR_CODES.requiredFieldMissing);
  }

  const value = (input[key] as string).trim();
  if (!value) return createFailure(APPLICATION_ERROR_CODES.textInvalid);
  if (value.length > maximumLength) return createFailure(APPLICATION_ERROR_CODES.textTooLong);
  return createSuccess(value);
};

const validateOptionalText = (
  input: InputObject,
  key: string,
  maximumLength: number
): ApplicationOperationResult<string | undefined> => {
  if (!hasOwn(input, key)) return createSuccess(undefined);
  return validateRequiredText(input, key, maximumLength);
};

const validateUuid = (value: unknown): ApplicationOperationResult<string> => {
  if (typeof value !== "string" || !uuidPattern.test(value.trim())) {
    return createFailure(APPLICATION_ERROR_CODES.identifierInvalid);
  }
  return createSuccess(value.trim());
};

const validateOptionalBoolean = (
  input: InputObject,
  key: string
): ApplicationOperationResult<boolean | undefined> => {
  if (!hasOwn(input, key)) return createSuccess(undefined);
  if (typeof input[key] !== "boolean") {
    return createFailure(APPLICATION_ERROR_CODES.fieldTypeInvalid);
  }
  return createSuccess(input[key] as boolean);
};

const validatePlatform = (value: unknown): ApplicationOperationResult<ApplicationPlatform> => {
  if (typeof value !== "string" || !APPLICATION_PLATFORMS.includes(value as ApplicationPlatform)) {
    return createFailure(APPLICATION_ERROR_CODES.platformInvalid);
  }
  return createSuccess(value as ApplicationPlatform);
};

const validateOptionalPlatform = (
  input: InputObject
): ApplicationOperationResult<ApplicationPlatform | undefined> =>
  hasOwn(input, "platform") ? validatePlatform(input.platform) : createSuccess(undefined);

export const validateExecutablePath = (value: unknown): ApplicationOperationResult<string> => {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return createFailure(APPLICATION_ERROR_CODES.executablePathInvalid);
  }
  if (value.length > executablePathMaximumLength) {
    return createFailure(APPLICATION_ERROR_CODES.textTooLong);
  }
  if (
    unsafeExecutablePathCharacterPattern.test(value) ||
    !absoluteWindowsExecutablePattern.test(value) ||
    value.split("\\").some((segment) => segment === "." || segment === "..")
  ) {
    return createFailure(APPLICATION_ERROR_CODES.executablePathInvalid);
  }
  return createSuccess(value);
};

const validateOptionalExecutablePath = (
  input: InputObject
): ApplicationOperationResult<string | undefined> =>
  hasOwn(input, "executablePath")
    ? validateExecutablePath(input.executablePath)
    : createSuccess(undefined);

const validateAliases = (value: unknown): ApplicationOperationResult<string[]> => {
  if (!Array.isArray(value) || value.length === 0 || value.length > applicationAliasMaximumCount) {
    return createFailure(APPLICATION_ERROR_CODES.fieldTypeInvalid);
  }

  const aliases: string[] = [];
  const normalizedAliases = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return createFailure(APPLICATION_ERROR_CODES.fieldTypeInvalid);
    const alias = item.trim();
    if (!alias) return createFailure(APPLICATION_ERROR_CODES.textInvalid);
    if (alias.length > applicationAliasMaximumLength) {
      return createFailure(APPLICATION_ERROR_CODES.textTooLong);
    }
    const normalizedAlias = alias.toLocaleLowerCase("en-US");
    if (normalizedAliases.has(normalizedAlias)) {
      return createFailure(APPLICATION_ERROR_CODES.duplicateAlias);
    }
    normalizedAliases.add(normalizedAlias);
    aliases.push(alias);
  }

  return createSuccess(aliases);
};

const validateOptionalAliases = (
  input: InputObject
): ApplicationOperationResult<string[] | undefined> =>
  hasOwn(input, "aliases") ? validateAliases(input.aliases) : createSuccess(undefined);

export const validateApplicationAlias = (value: unknown): ApplicationOperationResult<string> => {
  if (typeof value !== "string") return createFailure(APPLICATION_ERROR_CODES.fieldTypeInvalid);
  const alias = value.trim();
  if (!alias) return createFailure(APPLICATION_ERROR_CODES.textInvalid);
  if (alias.length > applicationAliasMaximumLength) {
    return createFailure(APPLICATION_ERROR_CODES.textTooLong);
  }
  return createSuccess(alias);
};

export const validateRegisterApplicationInput = (
  input: unknown
): ApplicationOperationResult<RegisterApplicationInput> => {
  const object = validateObject(input, [
    "name",
    "executablePath",
    "aliases",
    "platform",
    "isFavorite",
    "isEnabled"
  ]);
  if (!object.ok) return object;

  const name = validateRequiredText(object.data, "name", applicationNameMaximumLength);
  if (!name.ok) return name;
  const executablePath = validateExecutablePath(object.data.executablePath);
  if (!executablePath.ok) return executablePath;
  const aliases = validateAliases(object.data.aliases);
  if (!aliases.ok) return aliases;
  const platform = validateOptionalPlatform(object.data);
  if (!platform.ok) return platform;
  const isFavorite = validateOptionalBoolean(object.data, "isFavorite");
  if (!isFavorite.ok) return isFavorite;
  const isEnabled = validateOptionalBoolean(object.data, "isEnabled");
  if (!isEnabled.ok) return isEnabled;

  return createSuccess({
    name: name.data,
    executablePath: executablePath.data,
    aliases: aliases.data,
    ...(platform.data === undefined ? {} : { platform: platform.data }),
    ...(isFavorite.data === undefined ? {} : { isFavorite: isFavorite.data }),
    ...(isEnabled.data === undefined ? {} : { isEnabled: isEnabled.data })
  });
};

export const validateUpdateApplicationInput = (
  input: unknown
): ApplicationOperationResult<UpdateApplicationInput> => {
  const object = validateObject(input, [
    "applicationId",
    "name",
    "executablePath",
    "aliases",
    "isFavorite",
    "isEnabled"
  ]);
  if (!object.ok) return object;
  if (Object.keys(object.data).every((key) => key === "applicationId")) {
    return createFailure(APPLICATION_ERROR_CODES.updateEmpty);
  }

  const applicationId = validateUuid(object.data.applicationId);
  if (!applicationId.ok) return applicationId;
  const name = validateOptionalText(object.data, "name", applicationNameMaximumLength);
  if (!name.ok) return name;
  const executablePath = validateOptionalExecutablePath(object.data);
  if (!executablePath.ok) return executablePath;
  const aliases = validateOptionalAliases(object.data);
  if (!aliases.ok) return aliases;
  const isFavorite = validateOptionalBoolean(object.data, "isFavorite");
  if (!isFavorite.ok) return isFavorite;
  const isEnabled = validateOptionalBoolean(object.data, "isEnabled");
  if (!isEnabled.ok) return isEnabled;

  return createSuccess({
    applicationId: applicationId.data,
    ...(name.data === undefined ? {} : { name: name.data }),
    ...(executablePath.data === undefined ? {} : { executablePath: executablePath.data }),
    ...(aliases.data === undefined ? {} : { aliases: aliases.data }),
    ...(isFavorite.data === undefined ? {} : { isFavorite: isFavorite.data }),
    ...(isEnabled.data === undefined ? {} : { isEnabled: isEnabled.data })
  });
};

export const validateApplicationListInput = (
  input: unknown
): ApplicationOperationResult<ApplicationListInput> => {
  const object = validateObject(input, ["enabled", "favorite", "limit"]);
  if (!object.ok) return object;
  const enabled = validateOptionalBoolean(object.data, "enabled");
  if (!enabled.ok) return enabled;
  const favorite = validateOptionalBoolean(object.data, "favorite");
  if (!favorite.ok) return favorite;

  let limit: number | undefined;
  if (hasOwn(object.data, "limit")) {
    if (
      typeof object.data.limit !== "number" ||
      !Number.isInteger(object.data.limit) ||
      object.data.limit < 1 ||
      object.data.limit > applicationListMaximumLimit
    ) {
      return createFailure(APPLICATION_ERROR_CODES.fieldTypeInvalid);
    }
    limit = object.data.limit;
  }

  return createSuccess({
    ...(enabled.data === undefined ? {} : { enabled: enabled.data }),
    ...(favorite.data === undefined ? {} : { favorite: favorite.data }),
    ...(limit === undefined ? {} : { limit })
  });
};
