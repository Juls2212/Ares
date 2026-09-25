import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { getBrowserThemeStorage, initializeThemePreference } from "./features/settings/theme-preference";
import "./styles/ares.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element was not found.");
}

initializeThemePreference(document.documentElement, getBrowserThemeStorage());

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
