import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AresApi,
  type OperationResult,
  type SystemCapabilities,
  type SystemStatusData
} from "../shared/contracts";

const aresApi = {
  system: {
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.system.getStatus) as Promise<
        OperationResult<SystemStatusData>
      >,
    getCapabilities: () =>
      ipcRenderer.invoke(IPC_CHANNELS.system.getCapabilities) as Promise<
        OperationResult<SystemCapabilities>
      >
  }
} satisfies AresApi;

contextBridge.exposeInMainWorld("ares", aresApi);
