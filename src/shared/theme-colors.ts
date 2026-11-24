/**
 * The one header background per theme. The renderer header paints it and Main passes it as the title bar overlay color,
 * so the Windows buttons area and the header are the same color. Both sides import this table.
 */
export const HEADER_BACKGROUND = { dark: "#041a1e", light: "#dcebe7" } as const;
