import type { ThemeName } from "../../theme/themes";

/** The Spanish name, also used as the tooltip: it says what a press does, so it flips with the current theme. */
export const themeToggleLabel = (current: ThemeName): string => (current === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");

/** A press asks for the opposite explicit theme. "Automático" stays a tray-only choice. */
export const oppositeTheme = (current: ThemeName): "light" | "dark" => (current === "dark" ? "light" : "dark");

/**
 * The header's theme button: a chamfered frame and a technical lightbulb that shows the CURRENT theme (dark = off,
 * light = on). It only sends the closed preference to Main; the effective theme comes back through prefers-color-scheme.
 */
export const ThemeToggle = ({ current, onToggle }: { current: ThemeName; onToggle: (preference: "light" | "dark") => void }) => {
  const label = themeToggleLabel(current);
  return <button aria-label={label} className="theme-toggle" data-mode={current} onClick={() => onToggle(oppositeTheme(current))} title={label} type="button">
    <svg aria-hidden="true" className="theme-toggle__frame" focusable="false" viewBox="0 0 46 32"><polygon className="theme-toggle__poly" points="7,.5 45.5,.5 45.5,25 39,31.5 .5,31.5 .5,7" /></svg>
    <svg aria-hidden="true" className="theme-toggle__bulb" focusable="false" viewBox="0 0 20 24">
      <g className="theme-toggle__rays"><path d="M1.2 3.2L-.4 1.6M18.8 3.2L20.4 1.6M-.2 8.6H-2M20.2 8.6H22" /></g>
      <polygon className="theme-toggle__glass" points="10,1.5 15,3.4 17.5,8 16,12.4 13.6,15 13.6,17 6.4,17 6.4,15 4,12.4 2.5,8 5,3.4" />
      <path className="theme-toggle__filament" d="M7.6 17V11.4L10 8.8L12.4 11.4V17" />
      <circle className="theme-toggle__node" cx="10" cy="8.8" r=".95" /><circle className="theme-toggle__node" cx="7.6" cy="11.4" r=".8" /><circle className="theme-toggle__node" cx="12.4" cy="11.4" r=".8" />
      <path className="theme-toggle__base" d="M6.6 19H13.4M7.2 20.9H12.8M8.3 22.8H11.7" />
    </svg>
    <i aria-hidden="true" className="theme-toggle__led" />
  </button>;
};
