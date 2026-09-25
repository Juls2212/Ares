import type { AssistantContextSelection } from "../../shared/assistant-contracts";

/** Per-webContents ephemeral selection storage. It never persists outside Electron Main memory. */
export type AssistantContextStore = {
  set: (webContentsId: number, selection: AssistantContextSelection) => void;
  get: (webContentsId: number) => AssistantContextSelection | undefined;
  clear: (webContentsId: number) => void;
  removeWindow: (webContentsId: number) => void;
};

export const createAssistantContextStore = (): AssistantContextStore => {
  const selections = new Map<number, AssistantContextSelection>();

  return {
    set: (webContentsId, selection) => {
      selections.set(webContentsId, selection);
    },
    get: (webContentsId) => selections.get(webContentsId),
    clear: (webContentsId) => {
      selections.delete(webContentsId);
    },
    removeWindow: (webContentsId) => {
      selections.delete(webContentsId);
    }
  };
};
