import type { AssistantContextSelection, AssistantCurrentContext } from "../../shared/assistant-contracts";

/** Per-webContents ephemeral selection storage. It never persists outside Electron Main memory. */
export type AssistantContextStore = {
  set: (webContentsId: number, selection: AssistantContextSelection, providerContext: AssistantCurrentContext) => void;
  get: (webContentsId: number) => AssistantContextSelection | undefined;
  getProviderContext: (webContentsId: number) => AssistantCurrentContext | undefined;
  clear: (webContentsId: number) => void;
  removeWindow: (webContentsId: number) => void;
};

export const createAssistantContextStore = (): AssistantContextStore => {
  const selections = new Map<number, { selection: AssistantContextSelection; providerContext: AssistantCurrentContext }>();

  return {
    set: (webContentsId, selection, providerContext) => {
      selections.set(webContentsId, { selection, providerContext });
    },
    get: (webContentsId) => selections.get(webContentsId)?.selection,
    getProviderContext: (webContentsId) => selections.get(webContentsId)?.providerContext,
    clear: (webContentsId) => {
      selections.delete(webContentsId);
    },
    removeWindow: (webContentsId) => {
      selections.delete(webContentsId);
    }
  };
};
