/**
 * The interpreter accepts natural-language data, not authority to alter its
 * fixed policy. These checks intentionally run before a provider request.
 */
const normalizeForSafetyCheck = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US");

const instructionInjectionPatterns = [
  /\b(?:ignore|ignora|omite|omitir|olvida|anula)\b.{0,80}\b(?:instruccion(?:es)?|regla|sistema|desarrollador|confirmacion|seguridad)\b/u,
  /\b(?:system\s*prompt|prompt\s+del\s+sistema|developer\s*instruction|instruccion(?:es)?\s+del\s+desarrollador)\b/u,
  /\b(?:api[\s_-]*key|clave\s+api|secret(?:o)?|contrasena|password|token|process\.env|variable(?:s)?\s+de\s+entorno)\b/u,
  /\b(?:sql|select\s+.+\s+from|insert\s+into|delete\s+from|drop\s+table|ruta\s+interna|hidden\s+api|api\s+oculta)\b/u,
  /\b(?:powershell|cmd(?:\.exe)?|bash|zsh|child_process|execfile|\bexec\b|\bspawn\b)\b/u,
  /\b(?:bypass|saltar|evitar)\b.{0,80}\b(?:confirmacion|confirmar|seguridad)\b/u
];

const unsafeDraftTextPattern =
  /(?:[;&|`]|\b(?:powershell|cmd(?:\.exe)?|bash|zsh|child_process|execfile|\bexec\b|\bspawn\b|process\.env|api[\s_-]*key|secret(?:o)?|contrasena|password|token|sql)\b)/iu;

/** Rejects attempts to obtain or override privileged interpreter behavior. */
export const isUnsafeAssistantInstruction = (instruction: string): boolean => {
  const normalized = normalizeForSafetyCheck(instruction);
  return instructionInjectionPatterns.some((pattern) => pattern.test(normalized));
};

/**
 * File and application values are never command channels. This is an extra
 * interpreter boundary in addition to the action-specific trusted validators.
 */
export const isUnsafeAssistantDraftText = (value: unknown): boolean =>
  typeof value === "string" && unsafeDraftTextPattern.test(normalizeForSafetyCheck(value));
