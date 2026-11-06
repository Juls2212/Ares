import type { Menu } from "electron";

/** Hides and disables the native full-screen command without mutating construction-only properties. */
export const removeFullScreenMenuCommand = (menu: Menu): boolean => {
  let changed = false;
  for (const item of menu.items) {
    if (item.role === "togglefullscreen") {
      item.visible = false;
      item.enabled = false;
      changed = true;
    }
    if (item.submenu && removeFullScreenMenuCommand(item.submenu)) changed = true;
  }
  return changed;
};
