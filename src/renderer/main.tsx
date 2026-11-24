import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { readSystemTheme } from "./theme/theme-store";
import { createThemeTransitionController } from "./theme/theme-transition";
import { createDomThemeTransitionDependencies } from "./theme/theme-transition-dom";
import { themeNameFromQuery } from "./theme/themes";
import "./styles/ares-hud.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element was not found.");
}

// The theme follows Windows (or the choice made in the tray menu or the toggle) through prefers-color-scheme; no IPC is involved.
// The first theme is applied without animation; every later change plays the circular wave when it can.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const themeTransition = createThemeTransitionController(createDomThemeTransitionDependencies());
themeTransition.initialize(readSystemTheme());
darkQuery.addEventListener("change", () => themeTransition.change(themeNameFromQuery(darkQuery.matches)));

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
