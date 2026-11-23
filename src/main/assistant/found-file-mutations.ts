import type { SupervisedFileRoot } from "../../shared/supervised-file-contracts";
import { createPhraseMatcher, POLITE_PREFIX_ANCHORED } from "../../shared/phrase-kit";
import { foldAccentsOneToOne, foldForAlias, trimNameFragment } from "../../shared/text-fold";
import { parseOrdinalPhrase, type OrdinalReference } from "./found-file-references";

/**
 * Deterministic classification of «renombra el primero a X», «mueve el segundo a Documentos»,
 * «organiza estos archivos en una carpeta llamada X en Documentos» and «elimina el tercero».
 * It only reads the utterance text: it never touches the last-search store and never yields a path.
 */
export type OrdinalSelection = { all: true } | { ordinals: OrdinalReference[] };

export type FileMutationCommand =
  | { kind: "RENAME"; ordinal: OrdinalReference; newName: string }
  | { kind: "DELETE"; ordinal: OrdinalReference }
  /** Several items, permanent deletion, or a typed path: none of these is available. */
  | { kind: "DELETE_UNSUPPORTED" }
  | { kind: "MOVE"; selection: OrdinalSelection; destination: { root: SupervisedFileRoot } | { folderName: string } }
  | { kind: "ORGANIZE"; selection: OrdinalSelection; folderName: string; root: SupervisedFileRoot }
  | { kind: "INCOMPLETE"; action: "RENAME" | "DELETE" | "MOVE" | "ORGANIZE"; missing: "SELECTION" | "DESTINATION" | "NAME" };

const ROOT_ALIASES: Readonly<Record<string, SupervisedFileRoot>> = {
  escritorio: "DESKTOP", "el escritorio": "DESKTOP",
  documentos: "DOCUMENTS", "mis documentos": "DOCUMENTS", "la carpeta documentos": "DOCUMENTS",
  descargas: "DOWNLOADS", "mis descargas": "DOWNLOADS", "la carpeta descargas": "DOWNLOADS",
  imagenes: "PICTURES", "mis imagenes": "PICTURES",
  musica: "MUSIC", "mi musica": "MUSIC",
  videos: "VIDEOS", "mis videos": "VIDEOS"
};

export const parseRootAlias = (text: string): SupervisedFileRoot | undefined => {
  const key = foldForAlias(text);
  return Object.hasOwn(ROOT_ALIASES, key) ? ROOT_ALIASES[key] : undefined;
};

/** Every phrase that selects all found items; matched whole against folded text. */
const ALL_SELECTION_PHRASES = [
  "todo", "todos", "todas", "todo esto", "todos estos", "todos esos",
  "todos los archivos", "todos los resultados", "todos los elementos", "todos los items",
  "estos", "estos archivos", "estos elementos", "estos resultados",
  "estas",
  "esos", "esos archivos", "esos elementos", "esos resultados",
  "esas",
  "los archivos", "los resultados", "los elementos"
];
const ALL_SELECTION = createPhraseMatcher(ALL_SELECTION_PHRASES);

const parseSelectionPhrase = (phrase: string): OrdinalSelection | undefined => {
  const normalized = foldForAlias(phrase);
  if (ALL_SELECTION.test(normalized)) return { all: true };
  const parts = normalized.split(/\s*,\s*|\s+y\s+|\s+e\s+/u).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 10) return undefined;
  const ordinals: OrdinalReference[] = [];
  for (const part of parts) {
    const parsed = parseOrdinalPhrase(part);
    if (parsed === undefined) return undefined;
    ordinals.push(parsed);
  }
  return { ordinals };
};

const PREFIX = POLITE_PREFIX_ANCHORED;
const RENAME = new RegExp(`${PREFIX}(?:renombra(?:r)?|cambia(?:le)? el nombre (?:de|del|al))\\s+(?<target>.+?)\\s+(?:a|como|por)\\s+(?<name>.+?)\\s*$`, "iud");
const MOVE = new RegExp(`${PREFIX}(?:mueve(?:lo|los)?|mover)\\s+(?<selection>.+?)\\s+(?:a|al|hacia|en)\\s+(?<destination>.+?)\\s*$`, "iud");
const ORGANIZE = new RegExp(
  `${PREFIX}(?:organiza(?:r)?|ordena(?:r)?)\\s+(?<selection>.+?)\\s+en\\s+(?:una\\s+|la\\s+)?carpeta\\s+(?:llamada\\s+|de\\s+nombre\\s+|que\\s+se\\s+llame\\s+)?(?<rest>.+?)\\s*$`,
  "iud"
);
const TRASH = new RegExp(`${PREFIX}(?:manda|envia|lleva|mueve|mover)\\s+(?<target>.+?)\\s+a\\s+la\\s+papelera\\s*$`, "iud");
const DELETE = new RegExp(`${PREFIX}(?:elimina(?:r)?|borra(?:r)?|suprime|suprimir)\\b\\s*(?<target>.*?)\\s*$`, "iud");

const PERMANENT = /(para siempre|permanente|definitiv|sin (?:pasar por )?(?:la )?papelera|irreversible)/u;
const PATH_LIKE = /[\\/]|\b[a-z]:|\.\.|\*/iu;
const BATCH = /\b(?:todo|todos|todas|varios|varias|ambos|ambas|estos|estas|esos|esas)\b|,|\sy\s/u;

const groupText = (match: RegExpExecArray, group: string, original: string): string => {
  const indices = (match as RegExpExecArray & { indices?: { groups?: Record<string, [number, number]> } }).indices?.groups?.[group];
  return indices ? original.slice(indices[0], indices[1]) : "";
};

const classifyDelete = (target: string, original: string): FileMutationCommand => {
  const normalized = foldForAlias(target);
  if (PERMANENT.test(foldForAlias(original)) || PATH_LIKE.test(original) || BATCH.test(normalized)) {
    return { kind: "DELETE_UNSUPPORTED" };
  }
  const ordinal = parseOrdinalPhrase(target);
  return ordinal === undefined
    ? { kind: "INCOMPLETE", action: "DELETE", missing: "SELECTION" }
    : { kind: "DELETE", ordinal };
};

export const parseFileMutationCommand = (instruction: string): FileMutationCommand | undefined => {
  const original = instruction.trim().replace(/[¿¡]/gu, "");
  const folded = foldAccentsOneToOne(original);

  const trash = TRASH.exec(folded);
  if (trash) return classifyDelete(groupText(trash, "target", original), original);

  const rename = RENAME.exec(folded);
  if (rename) {
    const ordinal = parseOrdinalPhrase(groupText(rename, "target", original));
    if (ordinal === undefined) return { kind: "INCOMPLETE", action: "RENAME", missing: "SELECTION" };
    const newName = trimNameFragment(groupText(rename, "name", original));
    return newName ? { kind: "RENAME", ordinal, newName } : { kind: "INCOMPLETE", action: "RENAME", missing: "NAME" };
  }

  const organize = ORGANIZE.exec(folded);
  if (organize) {
    const selection = parseSelectionPhrase(groupText(organize, "selection", original));
    if (!selection) return { kind: "INCOMPLETE", action: "ORGANIZE", missing: "SELECTION" };
    const rest = groupText(organize, "rest", original);
    const split = /^(?<name>.+?)\s+en\s+(?<root>.+?)$/iu.exec(rest);
    const root = split?.groups ? parseRootAlias(split.groups.root ?? "") : undefined;
    const folderName = trimNameFragment(split?.groups?.name ?? "");
    return root && folderName
      ? { kind: "ORGANIZE", selection, folderName, root }
      : { kind: "INCOMPLETE", action: "ORGANIZE", missing: "DESTINATION" };
  }

  const move = MOVE.exec(folded);
  if (move) {
    const selection = parseSelectionPhrase(groupText(move, "selection", original));
    if (!selection) return { kind: "INCOMPLETE", action: "MOVE", missing: "SELECTION" };
    const destinationText = trimNameFragment(
      groupText(move, "destination", original).replace(/^(?:la\s+|el\s+|mi\s+|mis\s+)?(?:carpeta\s+|folder\s+)?(?:llamada\s+)?/iu, "")
    );
    if (!destinationText) return { kind: "INCOMPLETE", action: "MOVE", missing: "DESTINATION" };
    const root = parseRootAlias(destinationText);
    return { kind: "MOVE", selection, destination: root ? { root } : { folderName: destinationText } };
  }

  const remove = DELETE.exec(folded);
  if (remove) return classifyDelete(groupText(remove, "target", original), original);
  return undefined;
};
