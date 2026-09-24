import { describe, expect, it, vi } from "vitest";

import { createWebPageLauncher } from "../src/main/applications/web-page-launcher";
import type { ApplicationLauncher } from "../src/main/applications/application-launcher";
import type { ApplicationService } from "../src/main/applications/application-service";
import type { ResolvedApplicationTarget } from "../src/main/applications/application-repositories";

const target: ResolvedApplicationTarget = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Google Chrome",
  platform: "WINDOWS",
  executablePath: "C:\\private\\chrome.exe",
  isEnabled: true
};

const createDependencies = () => {
  const applicationService = {
    resolveEnabledApplicationByAlias: vi.fn(async () => ({ ok: true as const, data: target }))
  } as unknown as ApplicationService;
  const applicationLauncher = {
    launchResolvedBrowserTarget: vi.fn(async () => ({ ok: true as const, data: { applicationName: "Google Chrome" } }))
  } as unknown as ApplicationLauncher;
  return { applicationService, applicationLauncher };
};

describe("trusted web page launcher", () => {
  it("re-resolves registered Chrome and launches only the fixed YouTube destination", async () => {
    const { applicationService, applicationLauncher } = createDependencies();
    const launcher = createWebPageLauncher({ applicationService, applicationLauncher, logError: vi.fn() });

    const result = await launcher.launch({ destination: "YOUTUBE", browser: "CHROME" });

    expect(applicationService.resolveEnabledApplicationByAlias).toHaveBeenCalledWith("chrome");
    expect(applicationLauncher.launchResolvedBrowserTarget).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ id: "YOUTUBE", url: "https://www.youtube.com/", browserAlias: "chrome" })
    );
    expect(result).toEqual({ ok: true, data: { applicationName: "Google Chrome", destination: "YOUTUBE" } });
    expect(JSON.stringify(result)).not.toContain("youtube.com");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("rejects malformed destinations, raw URLs, unsafe protocols, encoded bypasses, and browser arguments", async () => {
    const { applicationService, applicationLauncher } = createDependencies();
    const launcher = createWebPageLauncher({ applicationService, applicationLauncher, logError: vi.fn() });

    for (const input of [
      { destination: "SPOTIFY", browser: "CHROME" },
      { destination: "https://www.youtube.com/", browser: "CHROME" },
      { destination: "file:///C:/private.txt", browser: "CHROME" },
      { destination: "data:text/html,test", browser: "CHROME" },
      { destination: "javascript:alert(1)", browser: "CHROME" },
      { destination: "vbscript:msgbox(1)", browser: "CHROME" },
      { destination: "chrome://settings", browser: "CHROME" },
      { destination: "about:blank", browser: "CHROME" },
      { destination: "https://localhost", browser: "CHROME" },
      { destination: "https://127.0.0.1", browser: "CHROME" },
      { destination: "https%3A%2F%2Flocalhost", browser: "CHROME" },
      { destination: "YOUTUBE#--disable-web-security", browser: "CHROME" },
      { destination: "YOUTUBE", browser: "CHROME", argument: "--incognito" },
      { destination: "YOUTUBE", browser: "FIREFOX" }
    ]) {
      const result = await launcher.launch(input);
      expect(result).toMatchObject({ ok: false, error: { code: "WEB_PAGE_INPUT_INVALID" } });
      expect(JSON.stringify(result)).not.toContain("http");
    }
    expect(applicationService.resolveEnabledApplicationByAlias).not.toHaveBeenCalled();
    expect(applicationLauncher.launchResolvedBrowserTarget).not.toHaveBeenCalled();
  });

  it("maps missing or disabled Chrome to a controlled failure without default-browser fallback", async () => {
    const { applicationService, applicationLauncher } = createDependencies();
    vi.mocked(applicationService.resolveEnabledApplicationByAlias).mockResolvedValueOnce({
      ok: false,
      error: { code: "APPLICATION_NOT_FOUND", userMessage: "private database detail" }
    });
    const launcher = createWebPageLauncher({ applicationService, applicationLauncher, logError: vi.fn() });

    const result = await launcher.launch({ destination: "YOUTUBE", browser: "CHROME" });

    expect(result).toMatchObject({ ok: false, error: { code: "WEB_PAGE_BROWSER_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(applicationLauncher.launchResolvedBrowserTarget).not.toHaveBeenCalled();
    expect("launchByAlias" in applicationLauncher).toBe(false);
  });
});
