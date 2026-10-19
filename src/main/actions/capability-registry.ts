import type { ActionApprovalClass, ActionName } from "../../shared/action-contracts";

export const CAPABILITY_DOMAINS = [
  "INTERNAL_MEMORY",
  "APPLICATIONS",
  "WEB",
  "FILES",
  "MESSAGING"
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];
export type CapabilityExecutorCategory = "PLANNER" | "APPLICATION" | "WEB" | "FILES";

export type AssistantCapability = {
  action: ActionName;
  domain: Extract<CapabilityDomain, "INTERNAL_MEMORY" | "APPLICATIONS" | "WEB" | "FILES">;
  approval: ActionApprovalClass;
  enabled: true;
  executor: CapabilityExecutorCategory;
  label: string;
};

const internalMemoryCapabilities = [
  ["CREATE_TASK", "DIRECT", "Crear tarea"],
  ["UPDATE_TASK", "DIRECT", "Actualizar tarea"],
  ["COMPLETE_TASK", "DIRECT", "Completar tarea"],
  ["DELETE_TASK", "REINFORCED_CONFIRMATION_REQUIRED", "Eliminar tarea"],
  ["CREATE_EVENT", "DIRECT", "Crear evento"],
  ["UPDATE_EVENT", "DIRECT", "Actualizar evento"],
  ["DELETE_EVENT", "REINFORCED_CONFIRMATION_REQUIRED", "Eliminar evento"],
  ["CREATE_REMINDER", "DIRECT", "Crear recordatorio"],
  ["GET_TODAY_SCHEDULE", "DIRECT", "Consultar agenda de hoy"],
  ["GET_WEEK_SCHEDULE", "DIRECT", "Consultar agenda semanal"],
  ["GET_WEEKLY_SCHEDULE_DETAILS", "DIRECT", "Consultar horario semanal"],
  ["ANALYZE_WEEKLY_SCHEDULE", "DIRECT", "Analizar horario semanal"],
  ["GET_TODAY_AVAILABILITY", "DIRECT", "Consultar disponibilidad de hoy"],
  ["CREATE_WEEKLY_SCHEDULE", "CONFIRMATION_REQUIRED", "Crear horario semanal"],
  ["UPDATE_WEEKLY_SCHEDULE", "CONFIRMATION_REQUIRED", "Actualizar horario semanal"],
  ["CREATE_WEEKLY_ROUTINE", "CONFIRMATION_REQUIRED", "Crear bloque semanal"],
  ["UPDATE_WEEKLY_ROUTINE", "CONFIRMATION_REQUIRED", "Actualizar bloque semanal"],
  ["GET_CURRENT_DATE_TIME", "DIRECT", "Consultar fecha y hora"],
  ["GET_HABIT_PROGRESS", "DIRECT", "Consultar progreso de hábitos"],
  ["CREATE_HABIT", "CONFIRMATION_REQUIRED", "Crear hábito"],
  ["UPDATE_HABIT", "CONFIRMATION_REQUIRED", "Actualizar hábito"],
  ["COMPLETE_HABIT", "CONFIRMATION_REQUIRED", "Completar hábito"]
] as const satisfies ReadonlyArray<readonly [ActionName, ActionApprovalClass, string]>;

const applicationCapabilities = [
  ["OPEN_APPLICATION", "DIRECT", "Abrir aplicación registrada"],
  ["REGISTER_CATALOG_APPLICATION", "CONFIRMATION_REQUIRED", "Registrar aplicación aprobada"],
  ["REQUEST_CUSTOM_APPLICATION_REGISTRATION", "CONFIRMATION_REQUIRED", "Registrar aplicación propia"]
] as const satisfies ReadonlyArray<readonly [ActionName, ActionApprovalClass, string]>;

const webCapabilities = [
  ["OPEN_APPROVED_PAGE", "DIRECT", "Abrir sitio aprobado"],
  ["SEARCH_APPROVED_SITE", "DIRECT", "Buscar en sitio aprobado"]
] as const satisfies ReadonlyArray<readonly [ActionName, ActionApprovalClass, string]>;

/** The FILES domain is enabled for exactly these eight supervised actions; nothing else may be added implicitly. */
const filesCapabilities = [
  ["SEARCH_FILES", "DIRECT", "Buscar archivos"],
  ["REVEAL_FOUND_FILE", "DIRECT", "Mostrar archivo encontrado"],
  ["OPEN_FOUND_FILE", "CONFIRMATION_REQUIRED", "Abrir archivo encontrado"],
  ["CREATE_FOLDER", "CONFIRMATION_REQUIRED", "Crear carpeta"],
  ["RENAME_FOUND_ITEM", "CONFIRMATION_REQUIRED", "Renombrar elemento encontrado"],
  ["MOVE_FOUND_ITEMS", "CONFIRMATION_REQUIRED", "Mover elementos encontrados"],
  ["ORGANIZE_FOUND_ITEMS", "CONFIRMATION_REQUIRED", "Organizar elementos encontrados"],
  ["DELETE_FOUND_ITEM", "REINFORCED_CONFIRMATION_REQUIRED", "Enviar elemento encontrado a la Papelera"]
] as const satisfies ReadonlyArray<readonly [ActionName, ActionApprovalClass, string]>;

const createCapability = (
  action: ActionName,
  domain: AssistantCapability["domain"],
  approval: ActionApprovalClass,
  label: string,
  executor: CapabilityExecutorCategory
): AssistantCapability => ({ action, domain, approval, enabled: true, executor, label });

/**
 * Main-only registry of assistant actions that have a deliberate typed executor.
 * MESSAGING remains reserved; FILES is enabled only for the four supervised actions above.
 */
export const ENABLED_ASSISTANT_CAPABILITIES: readonly AssistantCapability[] = Object.freeze([
  ...internalMemoryCapabilities.map(([action, approval, label]) =>
    createCapability(action, "INTERNAL_MEMORY", approval, label, "PLANNER")),
  ...applicationCapabilities.map(([action, approval, label]) =>
    createCapability(action, "APPLICATIONS", approval, label, "APPLICATION")),
  ...webCapabilities.map(([action, approval, label]) =>
    createCapability(action, "WEB", approval, label, "WEB")),
  ...filesCapabilities.map(([action, approval, label]) =>
    createCapability(action, "FILES", approval, label, "FILES"))
]);

const capabilitiesByAction = new Map(
  ENABLED_ASSISTANT_CAPABILITIES.map((capability) => [capability.action, capability])
);

export const getEnabledAssistantCapability = (action: unknown): AssistantCapability | undefined =>
  typeof action === "string" ? capabilitiesByAction.get(action as ActionName) : undefined;

export const isEnabledAssistantAction = (action: unknown): action is ActionName =>
  getEnabledAssistantCapability(action) !== undefined;

export const getEnabledAssistantActionNames = (): readonly ActionName[] =>
  ENABLED_ASSISTANT_CAPABILITIES.map((capability) => capability.action);
