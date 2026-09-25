const DEVELOPMENT_RENDERER_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173"
]);

const toApprovedRendererOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") return "file:";
    return DEVELOPMENT_RENDERER_ORIGINS.has(url.origin) ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

/** Accepts only the fixed development origin or packaged file origin for the trusted renderer. */
export const isTrustedMicrophoneRequest = (
  loadedUrl: string,
  requestingUrlOrOrigin: string
): boolean => {
  const loadedOrigin = toApprovedRendererOrigin(loadedUrl);
  const requestingOrigin = toApprovedRendererOrigin(requestingUrlOrOrigin);
  return loadedOrigin !== undefined && loadedOrigin === requestingOrigin;
};

/** A media request is trusted only when it asks for exactly audio and no video. */
export const isAudioOnlyMediaRequest = (mediaTypes: readonly unknown[] | undefined): boolean =>
  Array.isArray(mediaTypes) && mediaTypes.length === 1 && mediaTypes[0] === "audio";

export type TrustedAudioMicrophoneRequest = {
  trustedWebContentsIds: ReadonlySet<number>;
  webContentsId: number;
  loadedUrl: string;
  requestingUrlOrOrigin: string;
  isMainFrame: boolean;
  mediaTypes: readonly unknown[] | undefined;
};

/** Combines the complete allowlist: one trusted Main-frame renderer, approved origin, audio only. */
export const isTrustedAudioMicrophoneRequest = (
  request: TrustedAudioMicrophoneRequest
): boolean =>
  request.isMainFrame && request.trustedWebContentsIds.has(request.webContentsId) &&
    isAudioOnlyMediaRequest(request.mediaTypes) &&
    isTrustedMicrophoneRequest(request.loadedUrl, request.requestingUrlOrOrigin);
