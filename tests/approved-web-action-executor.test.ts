import { describe, expect, it, vi } from "vitest";

import {
  composeApprovedWebUrl,
  createApprovedWebActionExecutor,
  isAllowedApprovedWebUrl,
  validateApprovedWebActionInput
} from "../src/main/actions/approved-web-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";

const actionId = "11111111-1111-4111-8111-111111111111";

describe("approved web action executor", () => {
  it.each([
    ["GOOGLE", "https://www.google.com/"],
    ["YOUTUBE", "https://www.youtube.com/"],
    ["SPOTIFY", "https://open.spotify.com/"]
  ] as const)("opens the exact %s home page through the Main wrapper", async (site, expectedUrl) => {
    const openExternal = vi.fn(async () => undefined);
    const executor = createApprovedWebActionExecutor({ openExternal, logError: vi.fn() });

    const outcome = await executor.execute(
      { actionId, action: "OPEN_APPROVED_PAGE", input: { site } },
      getActionPolicy("OPEN_APPROVED_PAGE")
    );

    expect(openExternal).toHaveBeenCalledWith(expectedUrl);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", data: { site, mode: "HOME" } });
    expect(JSON.stringify(outcome)).not.toContain("https://");
  });

  it.each([
    ["GOOGLE", "recetas de pasta", "https://www.google.com/search?q=recetas+de+pasta"],
    ["YOUTUBE", "tutoriales de React", "https://www.youtube.com/results?search_query=tutoriales+de+React"],
    ["SPOTIFY", "Natalia Lafourcade", "https://open.spotify.com/search/Natalia%20Lafourcade"]
  ] as const)("uses safe encoding for %s search queries", async (site, query, expectedUrl) => {
    const openExternal = vi.fn(async () => undefined);
    const executor = createApprovedWebActionExecutor({ openExternal, logError: vi.fn() });

    const outcome = await executor.execute(
      { actionId, action: "SEARCH_APPROVED_SITE", input: { site, query } },
      getActionPolicy("SEARCH_APPROVED_SITE")
    );

    expect(openExternal).toHaveBeenCalledWith(expectedUrl);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", data: { site, mode: "SEARCH" } });
    expect(JSON.stringify(outcome)).not.toContain(query);
  });

  it("rejects unsupported sites, raw URLs, controls, and oversized queries without opening anything", async () => {
    const openExternal = vi.fn(async () => undefined);
    const executor = createApprovedWebActionExecutor({ openExternal, logError: vi.fn() });

    for (const input of [
      { site: "BING" },
      { site: "GOOGLE", query: "https://example.com" },
      { site: "GOOGLE", query: "example.com" },
      { site: "GOOGLE", query: "javascript:alert(1)" },
      { site: "GOOGLE", query: "hello\nworld" },
      { site: "GOOGLE", query: "x".repeat(201) }
    ]) {
      const action = "query" in input ? "SEARCH_APPROVED_SITE" as const : "OPEN_APPROVED_PAGE" as const;
      const outcome = await executor.execute(
        { actionId, action, input } as never,
        getActionPolicy(action)
      );
      expect(outcome).toMatchObject({ status: "VALIDATION_FAILED" });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("blocks a tampered URL outside the exact HTTPS allowlist", () => {
    const valid = validateApprovedWebActionInput("SEARCH_APPROVED_SITE", { site: "YOUTUBE", query: "React" });
    if (!valid) throw new Error("Expected valid web input.");

    expect(composeApprovedWebUrl(valid).toString()).toBe("https://www.youtube.com/results?search_query=React");
    expect(isAllowedApprovedWebUrl(new URL("https://www.youtube.com.evil.example/results?search_query=React"), "YOUTUBE", "SEARCH")).toBe(false);
    expect(isAllowedApprovedWebUrl(new URL("http://www.youtube.com/results?search_query=React"), "YOUTUBE", "SEARCH")).toBe(false);
  });

  it("maps Main wrapper failures to a controlled result", async () => {
    const executor = createApprovedWebActionExecutor({ openExternal: vi.fn(async () => { throw new Error("system detail"); }), logError: vi.fn() });
    const outcome = await executor.execute(
      { actionId, action: "OPEN_APPROVED_PAGE", input: { site: "GOOGLE" } },
      getActionPolicy("OPEN_APPROVED_PAGE")
    );

    expect(outcome).toMatchObject({ status: "EXECUTION_FAILED", userSummary: "No se pudo abrir el sitio aprobado." });
    expect(JSON.stringify(outcome)).not.toContain("system detail");
  });
});
