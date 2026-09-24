import type { WebDestination } from "../../shared/action-contracts";

/**
 * This catalog is the only source of web URLs. Callers receive a destination
 * identifier at public boundaries and cannot supply a URL or browser argument.
 */
export type TrustedWebDestination = {
  id: WebDestination;
  url: "https://www.youtube.com/";
  browserAlias: "chrome";
};

const destinations: Record<WebDestination, TrustedWebDestination> = {
  YOUTUBE: {
    id: "YOUTUBE",
    url: "https://www.youtube.com/",
    browserAlias: "chrome"
  }
};

export const resolveTrustedWebDestination = (value: unknown): TrustedWebDestination | undefined =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(destinations, value)
    ? destinations[value as WebDestination]
    : undefined;
