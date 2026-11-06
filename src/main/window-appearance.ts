/**
 * Decides the window material from facts Main already has (platform, OS build, the system theme and the
 * accessibility settings Electron exposes). It reads no registry and adds no IPC: the renderer only receives
 * the result through the BrowserWindow options and one fixed stylesheet.
 */
export const ACRYLIC_MINIMUM_BUILD = 22_621;

/** Opaque fallback surfaces, identical to the renderer's `--surface-opaque` tokens. */
export const FALLBACK_SURFACE = { light: "#E4EEEA", dark: "#0D1D22" } as const;
export const TRANSPARENT_BACKGROUND = "#00000000";

export type WindowMaterial = "acrylic" | "opaque";

export type WindowAppearanceInput = {
  platform: NodeJS.Platform;
  /** The value of os.release(); on Windows it looks like 10.0.22631. */
  release: string;
  shouldUseDarkColors: boolean;
  shouldUseHighContrastColors: boolean;
  /** nativeTheme.prefersReducedTransparency. */
  prefersReducedTransparency: boolean;
};

export type WindowAppearance = {
  material: WindowMaterial;
  /** Only the options that concern the material; size, frame, aspect ratio and web preferences stay elsewhere. */
  options: { backgroundMaterial?: "acrylic"; backgroundColor: string };
  backgroundColor: string;
};

/** The build number of a Windows release string, or undefined when it cannot be read. */
export const parseWindowsBuild = (release: string): number | undefined => {
  const match = /^\d+\.\d+\.(\d+)/u.exec(release);
  return match ? Number(match[1]) : undefined;
};

export const supportsAcrylic = (platform: NodeJS.Platform, release: string): boolean => {
  if (platform !== "win32") return false;
  const build = parseWindowsBuild(release);
  return build !== undefined && build >= ACRYLIC_MINIMUM_BUILD;
};

export const getWindowAppearance = (input: WindowAppearanceInput): WindowAppearance => {
  const glass =
    supportsAcrylic(input.platform, input.release) &&
    !input.shouldUseHighContrastColors &&
    !input.prefersReducedTransparency;
  if (glass) {
    return {
      material: "acrylic",
      options: { backgroundMaterial: "acrylic", backgroundColor: TRANSPARENT_BACKGROUND },
      backgroundColor: TRANSPARENT_BACKGROUND
    };
  }
  const backgroundColor = input.shouldUseDarkColors ? FALLBACK_SURFACE.dark : FALLBACK_SURFACE.light;
  return { material: "opaque", options: { backgroundColor }, backgroundColor };
};

