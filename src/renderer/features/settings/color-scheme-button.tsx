import { colorButtonTitle, type ColorScheme } from "./color-schemes";

type ColorSchemeButtonProperties = {
  current: ColorScheme;
  next: ColorScheme;
  onCycle: () => void;
};

/**
 * The only appearance control: it moves to the next color scheme in the list. The small dot shows the color
 * the next press will bring; it is never a light/dark switch. The dot re-mounts on every change, which replays
 * its short opacity/scale blink (opacity only with reduced motion).
 */
export const ColorSchemeButton = ({ current, next, onCycle }: ColorSchemeButtonProperties) => (
  <button aria-label="Cambiar color" className="color-button" onClick={onCycle} title={colorButtonTitle(current, next)} type="button">
    <svg aria-hidden="true" focusable="false" height="18" viewBox="0 0 18 18" width="18">
      <path d="M9 2.2c2.6 3 4.6 5.3 4.6 7.7a4.6 4.6 0 0 1-9.2 0c0-2.4 2-4.7 4.6-7.7Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <circle className="color-button__dot" cx="9" cy="10.4" fill={next.accent} key={next.id} r="2.3" />
    </svg>
  </button>
);
