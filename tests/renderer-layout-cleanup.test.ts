import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = (): string => readFileSync("src/renderer/styles/ares.css", "utf8");

describe("renderer viewport layout cleanup", () => {
  it("uses a flex shell and content-sized workspace constraints instead of stacking viewport heights", () => {
    const css = styles();

    expect(css).toContain("flex-direction: column;");
    expect(css).toContain("min-height: 100dvh;");
    expect(css).toContain(".command-layout,\n.calendar-shell {");
    expect(css).toContain("min-height: 0;");
    expect(css).toContain("padding-bottom: 0;");
  });

  it("keeps Ares controls compact while retaining responsive neural core bounds", () => {
    const css = styles();

    expect(css).toContain("height: clamp(390px, 60vh, 575px);");
    expect(css).toContain("width: min(54vh, 86%, 510px);");
    expect(css).toContain(".command-dock textarea {");
    expect(css).toContain("min-height: 42px;");
    expect(css).toContain("@media (max-height: 700px) and (min-width: 700px)");
  });

  it("sizes the six-week calendar against the available viewport and retains rail scrolling for real long details", () => {
    const css = styles();

    expect(css).toContain("min-height: clamp(72px, calc((100dvh - 220px) / 6), 108px);");
    expect(css).toContain("max-height: calc(100dvh - 170px);");
    expect(css).toContain("overflow-y: auto;");
  });

  it("removes repeated background grids from the Ares and calendar surfaces", () => {
    const css = styles();

    expect(css).toContain(".ares-shell:has(.command-layout),\n.calendar-shell,\n.calendar-surface {");
    expect(css).toContain("background-image: none;");
  });
});
