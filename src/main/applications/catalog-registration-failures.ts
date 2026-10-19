/**
 * Closed, safe failure taxonomy for catalog application registration.
 * Messages are fixed Spanish text: they never carry paths, protocol strings,
 * persistence details, raw exceptions, transcripts, or user data.
 */
export const CATALOG_REGISTRATION_FAILURES = {
  UNKNOWN_CATALOG_KEY: {
    code: "APPLICATION_CATALOG_KEY_INVALID",
    userMessage: "Esa aplicación no está en el catálogo aprobado."
  },
  UNSUPPORTED_PLATFORM: {
    code: "APPLICATION_CATALOG_UNSUPPORTED_PLATFORM",
    userMessage: "Este sistema todavía no permite registrar aplicaciones aprobadas."
  },
  NOT_AVAILABLE: {
    code: "APPLICATION_CATALOG_UNAVAILABLE",
    userMessage: "No encontré esa aplicación disponible en este equipo."
  },
  ALREADY_REGISTERED: {
    code: "APPLICATION_CATALOG_ALREADY_REGISTERED",
    userMessage: "Esa aplicación ya está registrada."
  },
  ALIAS_CONFLICT: {
    code: "APPLICATION_CONFLICT",
    userMessage: "Ya existe una aplicación o alias con esos datos."
  },
  PREPARATION_FAILED: {
    code: "APPLICATION_CATALOG_PREPARATION_FAILED",
    userMessage: "No pude preparar el registro de la aplicación."
  },
  PERSISTENCE_FAILED: {
    code: "APPLICATION_CATALOG_PERSISTENCE_FAILED",
    userMessage: "No pude guardar el registro de la aplicación."
  }
} as const;

/** A registered catalog application whose fixed launch strategy failed; distinct from "not found". */
export const CATALOG_LAUNCH_FAILURE = {
  code: "APPLICATION_CATALOG_LAUNCH_FAILED",
  userMessage: "No pude abrir esa aplicación. Revisa que esté instalada."
} as const;

export type CatalogRegistrationFailure = keyof typeof CATALOG_REGISTRATION_FAILURES;

export const catalogRegistrationFailure = (category: CatalogRegistrationFailure): {
  ok: false;
  error: { code: string; userMessage: string };
} => ({
  ok: false,
  error: { ...CATALOG_REGISTRATION_FAILURES[category] }
});

/** Failure codes raised after the user confirmed, which are execution failures rather than validation failures. */
export const CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES: readonly string[] = [
  CATALOG_REGISTRATION_FAILURES.PREPARATION_FAILED.code,
  CATALOG_REGISTRATION_FAILURES.PERSISTENCE_FAILED.code,
  CATALOG_LAUNCH_FAILURE.code
];
