import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  path.resolve(process.cwd(), "src/renderer/App.tsx"),
  "utf8"
);

describe("temporary renderer messaging", () => {
  it("uses Spanish loading, success, and controlled error messages", () => {
    expect(appSource).toContain("Consultando estado técnico...");
    expect(appSource).toContain("La comunicación segura está en funcionamiento.");
    expect(appSource).toContain("No se pudo consultar el estado técnico de Ares.");
    expect(appSource).toContain('"disponible"');
  });
});
