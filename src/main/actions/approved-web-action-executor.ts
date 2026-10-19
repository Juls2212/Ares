import { shell } from "electron";

import {
  APPROVED_SITES,
  type ActionOutcome,
  type ActionPolicy,
  type ApprovedSite,
  type ApprovedWebActionProposal,
  type OpenApprovedPageInput,
  type SearchApprovedSiteInput
} from "../../shared/action-contracts";

const MAX_SEARCH_QUERY_LENGTH = 200;

const approvedOrigins: Record<ApprovedSite, string> = {
  GOOGLE: "https://www.google.com",
  YOUTUBE: "https://www.youtube.com",
  SPOTIFY: "https://open.spotify.com"
};

const siteNames: Record<ApprovedSite, string> = {
  GOOGLE: "Google",
  YOUTUBE: "YouTube",
  SPOTIFY: "Spotify"
};

type ApprovedWebActionExecutorDependencies = {
  openExternal: (url: string) => Promise<void>;
  logError: (message: string) => void;
};

export type ApprovedWebActionExecutor = {
  execute: (proposal: ApprovedWebActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

export type ValidatedApprovedWebInput =
  | { action: "OPEN_APPROVED_PAGE"; input: OpenApprovedPageInput }
  | { action: "SEARCH_APPROVED_SITE"; input: SearchApprovedSiteInput };

const defaultDependencies: ApprovedWebActionExecutorDependencies = {
  openExternal: (url) => shell.openExternal(url),
  logError: (message) => console.error(message)
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isApprovedSite = (value: unknown): value is ApprovedSite =>
  typeof value === "string" && APPROVED_SITES.includes(value as ApprovedSite);

const normalizeSearchQuery = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const query = value.trim();
  if (
    query.length === 0 ||
    query.length > MAX_SEARCH_QUERY_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(query) ||
    /(?:\b[a-z][a-z\d+.-]*:|\bwww\.|\b[a-z\d-]+(?:\.[a-z\d-]+)+\b)/iu.test(query)
  ) {
    return undefined;
  }
  return query;
};

/** Validates the only provider-authored fields accepted for approved web actions. */
export const validateApprovedWebActionInput = (
  action: unknown,
  input: unknown
): ValidatedApprovedWebInput | undefined => {
  if (!isRecord(input)) return undefined;
  if (action === "OPEN_APPROVED_PAGE") {
    return Object.keys(input).length === 1 && isApprovedSite(input.site)
      ? { action, input: { site: input.site } }
      : undefined;
  }
  if (action === "SEARCH_APPROVED_SITE") {
    const query = normalizeSearchQuery(input.query);
    return Object.keys(input).length === 2 && isApprovedSite(input.site) && query
      ? { action, input: { site: input.site, query } }
      : undefined;
  }
  return undefined;
};

const composeHomeUrl = (site: ApprovedSite): URL => new URL(`${approvedOrigins[site]}/`);

const composeSearchUrl = (site: ApprovedSite, query: string): URL => {
  if (site === "GOOGLE") {
    const url = new URL(`${approvedOrigins.GOOGLE}/search`);
    url.search = new URLSearchParams({ q: query }).toString();
    return url;
  }
  if (site === "YOUTUBE") {
    const url = new URL(`${approvedOrigins.YOUTUBE}/results`);
    url.search = new URLSearchParams({ search_query: query }).toString();
    return url;
  }
  const url = new URL(`${approvedOrigins.SPOTIFY}/`);
  url.pathname = `/search/${encodeURIComponent(query)}`;
  return url;
};

export const isAllowedApprovedWebUrl = (url: URL, site: ApprovedSite, mode: "HOME" | "SEARCH"): boolean => {
  if (url.protocol !== "https:" || url.origin !== approvedOrigins[site]) return false;
  if (mode === "HOME") return url.pathname === "/" && url.search === "" && url.hash === "";
  if (site === "GOOGLE") return url.pathname === "/search" && url.searchParams.size === 1 && url.searchParams.has("q") && url.hash === "";
  if (site === "YOUTUBE") return url.pathname === "/results" && url.searchParams.size === 1 && url.searchParams.has("search_query") && url.hash === "";
  return url.pathname.startsWith("/search/") && url.pathname.length > "/search/".length && url.search === "" && url.hash === "";
};

/** Exposed for focused Main-only tests; callers receive a URL object, never an IPC result. */
export const composeApprovedWebUrl = (input: ValidatedApprovedWebInput): URL =>
  input.action === "OPEN_APPROVED_PAGE"
    ? composeHomeUrl(input.input.site)
    : composeSearchUrl(input.input.site, input.input.query);

const failureOutcome = (
  proposal: ApprovedWebActionProposal,
  policy: ActionPolicy,
  userSummary: string,
  errorCode: string
): ActionOutcome => ({
  actionId: proposal.actionId,
  action: proposal.action,
  riskLevel: policy.riskLevel,
  status: "VALIDATION_FAILED",
  errorCode,
  userSummary
});

export const createApprovedWebActionExecutor = (
  overrides: Partial<ApprovedWebActionExecutorDependencies> = {}
): ApprovedWebActionExecutor => {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    async execute(proposal, policy) {
      const validated = validateApprovedWebActionInput(proposal.action, proposal.input);
      if (!validated) {
        return failureOutcome(proposal, policy, "No puedo abrir ese sitio o realizar esa búsqueda.", "APPROVED_WEB_INVALID");
      }

      const mode = validated.action === "OPEN_APPROVED_PAGE" ? "HOME" : "SEARCH";
      const url = composeApprovedWebUrl(validated);
      if (!isAllowedApprovedWebUrl(url, validated.input.site, mode)) {
        dependencies.logError("Approved web URL allowlist validation failed.");
        return failureOutcome(proposal, policy, "No puedo abrir ese sitio o realizar esa búsqueda.", "APPROVED_WEB_INVALID");
      }

      try {
        await dependencies.openExternal(url.toString());
      } catch {
        dependencies.logError("Approved web action failed.");
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "EXECUTION_FAILED",
          errorCode: "APPROVED_WEB_UNAVAILABLE",
          userSummary: "No se pudo abrir el sitio aprobado."
        };
      }

      const site = validated.input.site;
      return {
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: policy.riskLevel,
        status: "SUCCEEDED",
        data: { site, mode },
        userSummary: mode === "HOME" ? `Listo, abrí ${siteNames[site]}.` : `Listo, busqué en ${siteNames[site]}.`
      };
    }
  };
};
