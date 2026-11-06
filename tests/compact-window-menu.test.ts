import type { Menu } from "electron";
import { describe, expect, it, vi } from "vitest";
import { removeFullScreenMenuCommand } from "../src/main/compact-window-menu";

describe("compact native menu", () => {
  it("disables full-screen without writing read-only native properties or changing other commands", () => {
    const fullScreen = { role: "togglefullscreen", visible: true, enabled: true, accelerator: "F11", registerAccelerator: true };
    Object.defineProperties(fullScreen, {
      accelerator: { value: "F11", writable: false },
      registerAccelerator: { value: true, writable: false }
    });
    const close = { role: "close", enabled: true, click: vi.fn() };
    const minimize = { role: "minimize", enabled: true };
    const copy = { role: "copy", enabled: true, accelerator: "Control+C" };
    const menu = { items: [{ label: "Ver", submenu: { items: [fullScreen] } }, minimize, close, copy] };

    expect(removeFullScreenMenuCommand(menu as unknown as Menu)).toBe(true);
    expect(fullScreen).toMatchObject({ visible: false, enabled: false, accelerator: "F11", registerAccelerator: true });
    expect(menu.items[1]).toBe(minimize);
    expect(minimize).toEqual({ role: "minimize", enabled: true });
    expect(close.enabled).toBe(true);
    expect(copy).toEqual({ role: "copy", enabled: true, accelerator: "Control+C" });
    expect(close.click).not.toHaveBeenCalled();
  });

  it("leaves menus without full-screen commands unchanged", () => {
    const items = [{ role: "quit", visible: true, enabled: true }];
    expect(removeFullScreenMenuCommand({ items } as unknown as Menu)).toBe(false);
    expect(items).toEqual([{ role: "quit", visible: true, enabled: true }]);
  });
});
