import { win32 } from "node:path";
import {
  APPLICATION_CATALOG_KEYS,
  type ApplicationCatalogKey
} from "../../shared/application-contracts";

export type KnownWindowsLaunchCandidate = {
  executablePath: string;
  arguments: readonly string[];
};

/** Fixed Windows directories a catalog rule may be anchored to; nothing else can be a root. */
export type KnownWindowsCandidateRoot =
  | "PROGRAM_FILES"
  | "PROGRAM_FILES_X86"
  | "LOCAL_APP_DATA"
  | "ROAMING_APP_DATA";

/** One fixed candidate location: a closed root plus fixed path segments and fixed arguments. */
export type KnownWindowsCandidateRule = {
  root: KnownWindowsCandidateRoot;
  segments: readonly string[];
  arguments?: readonly string[];
};

/**
 * A catalog application is exactly one declarative entry. Adding an application needs its key in
 * APPLICATION_CATALOG_KEYS, one entry below, and a database enum migration; policy, executors,
 * persistence code and IPC are untouched. Launch protocols are deliberately not part of an entry.
 */
export type KnownApplicationDefinition = {
  key: ApplicationCatalogKey;
  displayName: string;
  defaultAlias: string;
  recognitionAliases: readonly string[];
  windowsCandidates: readonly KnownWindowsCandidateRule[];
};

const FIXED_PROGRAM_FILES = "C:\\Program Files";
const FIXED_PROGRAM_FILES_X86 = "C:\\Program Files (x86)";

const programFiles = (...segments: string[]): KnownWindowsCandidateRule => ({ root: "PROGRAM_FILES", segments });
const programFilesX86 = (...segments: string[]): KnownWindowsCandidateRule => ({ root: "PROGRAM_FILES_X86", segments });
const localAppData = (segments: string[], fixedArguments: readonly string[] = []): KnownWindowsCandidateRule => ({
  root: "LOCAL_APP_DATA",
  segments,
  ...(fixedArguments.length > 0 ? { arguments: fixedArguments } : {})
});
const roamingAppData = (...segments: string[]): KnownWindowsCandidateRule => ({ root: "ROAMING_APP_DATA", segments });
const storeAlias = (executable: string): KnownWindowsCandidateRule =>
  localAppData(["Microsoft", "WindowsApps", executable]);

/** This is the only catalog authority. Candidate rules are Main-only and never projected outward. */
const definitions = [
  {
    key: "GOOGLE_CHROME",
    displayName: "Google Chrome",
    defaultAlias: "chrome",
    recognitionAliases: ["chrome", "google chrome"],
    windowsCandidates: [
      programFiles("Google", "Chrome", "Application", "chrome.exe"),
      programFilesX86("Google", "Chrome", "Application", "chrome.exe"),
      localAppData(["Google", "Chrome", "Application", "chrome.exe"])
    ]
  },
  {
    key: "MICROSOFT_EDGE",
    displayName: "Microsoft Edge",
    defaultAlias: "edge",
    recognitionAliases: ["edge", "microsoft edge"],
    windowsCandidates: [
      programFilesX86("Microsoft", "Edge", "Application", "msedge.exe"),
      programFiles("Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData(["Microsoft", "Edge", "Application", "msedge.exe"])
    ]
  },
  {
    key: "MOZILLA_FIREFOX",
    displayName: "Mozilla Firefox",
    defaultAlias: "firefox",
    recognitionAliases: ["firefox", "mozilla firefox"],
    windowsCandidates: [
      programFiles("Mozilla Firefox", "firefox.exe"),
      programFilesX86("Mozilla Firefox", "firefox.exe"),
      localAppData(["Mozilla Firefox", "firefox.exe"])
    ]
  },
  {
    key: "SPOTIFY",
    displayName: "Spotify",
    defaultAlias: "spotify",
    recognitionAliases: ["spotify"],
    windowsCandidates: [
      programFiles("Spotify", "Spotify.exe"),
      roamingAppData("Spotify", "Spotify.exe"),
      storeAlias("Spotify.exe")
    ]
  },
  {
    key: "WHATSAPP",
    displayName: "WhatsApp",
    defaultAlias: "whatsapp",
    recognitionAliases: ["whatsapp", "whats app"],
    windowsCandidates: [
      storeAlias("WhatsApp.exe"),
      localAppData(["WhatsApp", "WhatsApp.exe"]),
      localAppData(["WhatsApp", "Update.exe"], ["--processStart", "WhatsApp.exe"])
    ]
  },
  {
    key: "MICROSOFT_WORD",
    displayName: "Microsoft Word",
    defaultAlias: "word",
    recognitionAliases: ["word", "microsoft word"],
    windowsCandidates: [
      programFiles("Microsoft Office", "root", "Office16", "WINWORD.EXE"),
      programFilesX86("Microsoft Office", "root", "Office16", "WINWORD.EXE")
    ]
  },
  {
    key: "VISUAL_STUDIO_CODE",
    displayName: "Visual Studio Code",
    defaultAlias: "vscode",
    recognitionAliases: ["visual studio code", "vs code", "vscode"],
    windowsCandidates: [
      programFiles("Microsoft VS Code", "Code.exe"),
      localAppData(["Programs", "Microsoft VS Code", "Code.exe"])
    ]
  },
  {
    key: "DISCORD",
    displayName: "Discord",
    defaultAlias: "discord",
    recognitionAliases: ["discord"],
    windowsCandidates: [localAppData(["Discord", "Update.exe"], ["--processStart", "Discord.exe"])]
  },
  {
    key: "CLAUDE",
    displayName: "Claude",
    defaultAlias: "claude",
    recognitionAliases: ["claude", "claude desktop"],
    windowsCandidates: [
      localAppData(["AnthropicClaude", "claude.exe"]),
      localAppData(["AnthropicClaude", "Update.exe"], ["--processStart", "claude.exe"]),
      storeAlias("claude.exe")
    ]
  }
] as const satisfies readonly KnownApplicationDefinition[];

/** Compile-time exhaustiveness: every catalog key must have exactly one declarative entry. */
type DefinedKeys = (typeof definitions)[number]["key"];
const catalogIsExhaustive: [Exclude<ApplicationCatalogKey, DefinedKeys>] extends [never] ? true : never = true;
void catalogIsExhaustive;

const byKey = new Map<ApplicationCatalogKey, KnownApplicationDefinition>(
  definitions.map((definition) => [definition.key, definition])
);

export const KNOWN_APPLICATION_CATALOG: readonly KnownApplicationDefinition[] = Object.freeze(definitions);

export const isKnownApplicationCatalogKey = (value: unknown): value is ApplicationCatalogKey =>
  typeof value === "string" && APPLICATION_CATALOG_KEYS.includes(value as ApplicationCatalogKey);

export const getKnownApplication = (key: unknown): KnownApplicationDefinition | undefined =>
  isKnownApplicationCatalogKey(key) ? byKey.get(key) : undefined;

/** Resolves a fixed rule against trusted Windows directories; the result is always an absolute path. */
export const toWindowsLaunchCandidate = (
  rule: KnownWindowsCandidateRule,
  directories: { localApplicationData: string; roamingApplicationData: string }
): KnownWindowsLaunchCandidate => {
  const root = rule.root === "PROGRAM_FILES"
    ? FIXED_PROGRAM_FILES
    : rule.root === "PROGRAM_FILES_X86"
      ? FIXED_PROGRAM_FILES_X86
      : rule.root === "LOCAL_APP_DATA"
        ? directories.localApplicationData
        : directories.roamingApplicationData;
  return { executablePath: win32.join(root, ...rule.segments), arguments: rule.arguments ?? [] };
};

/** Lowercases, strips diacritics and punctuation, and collapses whitespace for exact alias comparison. */
export const normalizeApplicationAlias = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

/** This is the bounded provider-safe projection; it intentionally excludes platform targets. */
export const getKnownApplicationProviderReferences = () =>
  KNOWN_APPLICATION_CATALOG.map(({ key, displayName, recognitionAliases }) => ({
    key,
    displayName,
    recognitionAliases: [...recognitionAliases]
  }));
