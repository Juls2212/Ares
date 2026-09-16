import type { AresApi } from "../shared/contracts";

declare global {
  interface Window {
    ares: AresApi;
  }
}

export {};
