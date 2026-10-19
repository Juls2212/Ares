import { app, shell } from "electron";
import { lstat, mkdir, readdir, realpath, rename } from "node:fs/promises";
import type { SupervisedFileRoot } from "../../shared/supervised-file-contracts";
import { createSupervisedFileService, type SupervisedFileService } from "./supervised-file-service";

/** Electron known-folder names for each approved root; no other location can be resolved. */
const KNOWN_FOLDER_NAMES: Readonly<Record<SupervisedFileRoot, "desktop" | "documents" | "downloads" | "pictures" | "music" | "videos">> = {
  DESKTOP: "desktop",
  DOCUMENTS: "documents",
  DOWNLOADS: "downloads",
  PICTURES: "pictures",
  MUSIC: "music",
  VIDEOS: "videos"
};

let supervisedFileService: SupervisedFileService | undefined;

export const getSupervisedFileService = (): SupervisedFileService => {
  supervisedFileService ??= createSupervisedFileService({
    filesystem: {
      readdir: (directory) => readdir(directory, { withFileTypes: true }),
      lstat: (entry) => lstat(entry),
      realpath: (entry) => realpath(entry),
      mkdir: async (directory) => {
        await mkdir(directory, { recursive: false });
      },
      rename: (from, to) => rename(from, to)
    },
    shell: {
      showItemInFolder: (target) => shell.showItemInFolder(target),
      openPath: (target) => shell.openPath(target),
      trashItem: (target) => shell.trashItem(target)
    },
    getKnownFolder: (root) => app.getPath(KNOWN_FOLDER_NAMES[root])
  });
  return supervisedFileService;
};
