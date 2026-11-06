/**
 * Closed failure taxonomy for the supervised FILES domain. Messages are fixed Spanish text and never
 * carry paths, file or folder names, queries, raw exceptions, or operating-system error text.
 */
export const FILES_FAILURES = {
  FILES_NO_RESULTS: "No encontré archivos que coincidan con tu búsqueda.",
  FILES_SEARCH_PARTIAL: "Los resultados pueden ser parciales.",
  FILES_STALE_SELECTION: "Esa selección ya no está disponible. Haz una nueva búsqueda.",
  FILES_TARGET_NOT_FOUND: "Ese elemento ya no existe. Haz una nueva búsqueda.",
  FILES_TYPE_BLOCKED: "No puedo abrir ese tipo de archivo.",
  FILES_ALREADY_EXISTS: "Ya existe un elemento con ese nombre. No se cambió nada.",
  FILES_INVALID_NAME: "El nombre no es válido.",
  FILES_INVALID_QUERY: "La búsqueda no es válida.",
  FILES_OUT_OF_SCOPE: "Esa ubicación no está permitida.",
  FILES_DESTINATION_INVALID: "El destino no es válido o no está permitido. No se movió nada.",
  FILES_RECYCLE_UNAVAILABLE: "No pude enviar el elemento a la Papelera. No se eliminó nada.",
  FILES_PARTIAL_COMPLETION: "La operación se detuvo antes de terminar. Haz una nueva búsqueda para revisar el resultado.",
  FILES_OPERATION_FAILED: "No se pudo completar la operación con archivos."
} as const;

export type FilesFailureCode = keyof typeof FILES_FAILURES;

/** Counts only: how many items were moved before a mid-way stop, and how many were not. */
export type FilesPartialCounts = { moved: number; failed: number };

export type FilesResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: FilesFailureCode; userMessage: string; counts?: FilesPartialCounts } };

export const filesFailure = <T>(code: FilesFailureCode, counts?: FilesPartialCounts): FilesResult<T> => ({
  ok: false,
  error: { code, userMessage: FILES_FAILURES[code], ...(counts ? { counts } : {}) }
});

export const filesSuccess = <T>(data: T): FilesResult<T> => ({ ok: true, data });

/** Codes that mean the operation itself failed rather than the request being invalid. */
export const FILES_EXECUTION_FAILURE_CODES: readonly string[] = [
  "FILES_OPERATION_FAILED",
  "FILES_RECYCLE_UNAVAILABLE",
  "FILES_PARTIAL_COMPLETION"
];
