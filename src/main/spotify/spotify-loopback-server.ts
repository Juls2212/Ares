import { createServer as createHttpServer } from "node:http";
import { SPOTIFY_CALLBACK_PATH, SPOTIFY_LOOPBACK_HOST, SPOTIFY_LOOPBACK_PORT } from "./spotify-config";

/**
 * One-shot loopback receiver for the authorization callback. It listens on 127.0.0.1:8888 only, accepts
 * exactly GET /callback with the expected state, closes itself after the first valid callback, a cancel
 * or the timeout, and answers with plain Spanish pages that never contain a code, a state or a token.
 */
export const SPOTIFY_CONNECT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_CODE_LENGTH = 1_024;
const CODE_PATTERN = /^[A-Za-z0-9_.~-]+$/u;
const EXPECTED_HOST = `${SPOTIFY_LOOPBACK_HOST}:${SPOTIFY_LOOPBACK_PORT}`;

export type LoopbackOutcome =
  | { status: "CODE"; code: string }
  | { status: "DENIED" }
  | { status: "TIMEOUT" }
  | { status: "CANCELLED" };

export type LoopbackStart =
  | { ok: true; outcome: Promise<LoopbackOutcome> }
  | { ok: false; reason: "PORT_BUSY" | "FAILED" };

export type SpotifyLoopbackServer = {
  /** Starts listening and resolves once the port is bound, so the browser can be opened safely afterwards. */
  start: (expectedState: string) => Promise<LoopbackStart>;
  /** Ends a waiting attempt as cancelled and closes the port. */
  cancel: () => void;
};

export type LoopbackRequest = {
  method?: string;
  url?: string;
  headers: { host?: string };
  socket: { remoteAddress?: string };
};
export type LoopbackResponse = {
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
};
export type LoopbackServerLike = {
  listen: (options: { host: string; port: number }, callback: () => void) => void;
  on: (event: "error", listener: (error: { code?: string }) => void) => void;
  close: () => void;
  closeAllConnections?: () => void;
};

type LoopbackDependencies = {
  createServer: (handler: (request: LoopbackRequest, response: LoopbackResponse) => void) => LoopbackServerLike;
  timeoutMs: number;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
  logError: (message: string) => void;
};

const page = (message: string): string =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ares</title></head><body><p>${message}</p></body></html>`;

const PAGES = {
  connected: page("Spotify quedó conectado. Puedes cerrar esta ventana y volver a Ares."),
  denied: page("No se conectó Spotify. Puedes cerrar esta ventana."),
  invalid: page("Solicitud no válida. Puedes cerrar esta ventana."),
  missing: page("No hay nada aquí. Puedes cerrar esta ventana.")
} as const;

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  Connection: "close"
};

const isLoopbackAddress = (address: string | undefined): boolean =>
  address === undefined || address === "127.0.0.1" || address === "::ffff:127.0.0.1" || address === "::1";

export const createSpotifyLoopbackServer = (overrides: Partial<LoopbackDependencies> = {}): SpotifyLoopbackServer => {
  const dependencies: LoopbackDependencies = {
    createServer: (handler) => createHttpServer(handler) as unknown as LoopbackServerLike,
    timeoutMs: SPOTIFY_CONNECT_TIMEOUT_MS,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    logError: (message) => console.error(message),
    ...overrides
  };
  let finishCurrent: ((outcome: LoopbackOutcome) => void) | undefined;

  return {
    cancel: () => finishCurrent?.({ status: "CANCELLED" }),
    start: (expectedState) =>
      new Promise<LoopbackStart>((resolveStart) => {
        finishCurrent?.({ status: "CANCELLED" });
        let settle: (outcome: LoopbackOutcome) => void = () => undefined;
        const outcome = new Promise<LoopbackOutcome>((resolve) => { settle = resolve; });
        let timer: unknown;
        let finished = false;

        const server = dependencies.createServer((request, response) => {
          const reply = (status: number, body: string): void => {
            response.writeHead(status, HEADERS);
            response.end(body);
          };
          if (request.method !== "GET") return reply(405, PAGES.invalid);
          if (request.headers.host !== EXPECTED_HOST || !isLoopbackAddress(request.socket.remoteAddress)) {
            return reply(400, PAGES.invalid);
          }
          let url: URL;
          try {
            url = new URL(request.url ?? "", `http://${EXPECTED_HOST}`);
          } catch {
            return reply(400, PAGES.invalid);
          }
          if (url.pathname !== SPOTIFY_CALLBACK_PATH) return reply(404, PAGES.missing);
          // Anything with a different state is rejected and the one-shot attempt keeps waiting.
          if (url.searchParams.get("state") !== expectedState) return reply(400, PAGES.invalid);
          if (url.searchParams.has("error")) {
            reply(200, PAGES.denied);
            return finish({ status: "DENIED" });
          }
          const code = url.searchParams.get("code");
          if (code === null || code.length === 0 || code.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(code)) {
            return reply(400, PAGES.invalid);
          }
          reply(200, PAGES.connected);
          finish({ status: "CODE", code });
        });

        function finish(result: LoopbackOutcome): void {
          if (finished) return;
          finished = true;
          if (finishCurrent === finish) finishCurrent = undefined;
          if (timer !== undefined) dependencies.clearTimer(timer);
          try {
            server.close();
            server.closeAllConnections?.();
          } catch {
            dependencies.logError("Spotify loopback server could not be closed.");
          }
          settle(result);
        }

        server.on("error", (error) => {
          if (finished) return;
          finished = true;
          if (finishCurrent === finish) finishCurrent = undefined;
          if (timer !== undefined) dependencies.clearTimer(timer);
          try { server.close(); } catch { /* the server never started listening */ }
          resolveStart({ ok: false, reason: error.code === "EADDRINUSE" ? "PORT_BUSY" : "FAILED" });
        });

        server.listen({ host: SPOTIFY_LOOPBACK_HOST, port: SPOTIFY_LOOPBACK_PORT }, () => {
          if (finished) return;
          finishCurrent = finish;
          timer = dependencies.setTimer(() => finish({ status: "TIMEOUT" }), dependencies.timeoutMs);
          resolveStart({ ok: true, outcome });
        });
      })
  };
};
