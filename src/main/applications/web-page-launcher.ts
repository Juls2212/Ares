import type { WebDestination } from "../../shared/action-contracts";
import type { ResolvedApplicationTarget } from "./application-repositories";
import { createApplicationLauncher, type ApplicationLauncher } from "./application-launcher";
import { getApplicationService } from "./application-composition";
import type { ApplicationService } from "./application-service";
import { resolveTrustedWebDestination } from "./trusted-web-destinations";

export type WebPageLaunchData = {
  applicationName: string;
  destination: WebDestination;
};

export type WebPageLaunchFailureCode =
  | "WEB_PAGE_INPUT_INVALID"
  | "WEB_PAGE_DESTINATION_UNSUPPORTED"
  | "WEB_PAGE_BROWSER_UNAVAILABLE"
  | "WEB_PAGE_LAUNCH_FAILED";

export type WebPageLaunchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: WebPageLaunchFailureCode; userMessage: string } };

export type WebPageLauncher = {
  launch: (input: unknown) => Promise<WebPageLaunchResult<WebPageLaunchData>>;
};

type WebPageLauncherDependencies = {
  applicationService: ApplicationService;
  applicationLauncher: ApplicationLauncher;
  logError: (message: string) => void;
};

const messages: Record<WebPageLaunchFailureCode, string> = {
  WEB_PAGE_INPUT_INVALID: "La solicitud de página web no es válida.",
  WEB_PAGE_DESTINATION_UNSUPPORTED: "Esa página web no está disponible.",
  WEB_PAGE_BROWSER_UNAVAILABLE: "No se encontró un navegador Chrome registrado y habilitado.",
  WEB_PAGE_LAUNCH_FAILED: "No se pudo abrir la página web autorizada."
};

const createFailure = <T>(code: WebPageLaunchFailureCode): WebPageLaunchResult<T> => ({
  ok: false,
  error: { code, userMessage: messages[code] }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveInput = (input: unknown): { destination: WebDestination } | undefined => {
  if (!isRecord(input) || Object.keys(input).length !== 2 || input.browser !== "CHROME") return undefined;
  const destination = resolveTrustedWebDestination(input.destination);
  return destination ? { destination: destination.id } : undefined;
};

/** Main-only web launch path. It resolves a fixed URL and the registered browser immediately before launch. */
export const createWebPageLauncher = (
  overrides: Partial<WebPageLauncherDependencies> = {}
): WebPageLauncher => {
  const dependencies: WebPageLauncherDependencies = {
    applicationService: overrides.applicationService ?? getApplicationService(),
    applicationLauncher: overrides.applicationLauncher ?? createApplicationLauncher(),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };

  return {
    launch: async (input) => {
      const parsed = resolveInput(input);
      if (!parsed) return createFailure("WEB_PAGE_INPUT_INVALID");
      const destination = resolveTrustedWebDestination(parsed.destination);
      if (!destination) return createFailure("WEB_PAGE_DESTINATION_UNSUPPORTED");

      let target: ResolvedApplicationTarget;
      try {
        const resolved = await dependencies.applicationService.resolveEnabledApplicationByAlias(destination.browserAlias);
        if (!resolved.ok) return createFailure("WEB_PAGE_BROWSER_UNAVAILABLE");
        target = resolved.data;
      } catch {
        dependencies.logError("Trusted browser resolution failed.");
        return createFailure("WEB_PAGE_BROWSER_UNAVAILABLE");
      }

      try {
        const launched = await dependencies.applicationLauncher.launchResolvedBrowserTarget(target, destination);
        if (!launched.ok) return createFailure("WEB_PAGE_LAUNCH_FAILED");
        return { ok: true, data: { applicationName: launched.data.applicationName, destination: destination.id } };
      } catch {
        dependencies.logError("Trusted web page launch failed.");
        return createFailure("WEB_PAGE_LAUNCH_FAILED");
      }
    }
  };
};
