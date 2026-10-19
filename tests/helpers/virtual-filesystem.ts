import path from "node:path";
import { vi } from "vitest";
import type { SupervisedFilesystem } from "../../src/main/files/supervised-file-service";
import { SUPERVISED_FILE_ROOTS, type SupervisedFileRoot } from "../../src/shared/supervised-file-contracts";

type NodeType = "dir" | "file" | "symlink";

export const HOME = "C:\\Users\\Juli";

export const folderFor = (root: SupervisedFileRoot): string =>
  path.join(HOME, { DESKTOP: "Desktop", DOCUMENTS: "Documents", DOWNLOADS: "Downloads", PICTURES: "Pictures", MUSIC: "Music", VIDEOS: "Videos" }[root]);

/**
 * An in-memory, case-insensitive filesystem like Windows. It has no remove operation at all, and a
 * rename onto an existing target silently overwrites (as Windows does), so tests can prove the
 * service never lets that happen.
 */
export const createVirtualFilesystem = () => {
  const nodes = new Map<string, { type: NodeType; name: string }>();
  const realpaths = new Map<string, string>();
  const key = (value: string): string => path.resolve(value).toLocaleLowerCase("en-US");
  const renameCalls: Array<[string, string]> = [];
  const mkdirCalls: string[] = [];
  const overwrites: string[] = [];
  const renameFailures = new Map<string, string>();

  const put = (target: string, type: NodeType): void => {
    nodes.set(key(target), { type, name: path.basename(target) });
  };
  for (const root of SUPERVISED_FILE_ROOTS) put(folderFor(root), "dir");

  const missing = (): Error => Object.assign(new Error("private detail C:\\Users\\Juli"), { code: "ENOENT" });
  const childrenOf = (directory: string) =>
    [...nodes.entries()].filter(([candidate]) => candidate !== key(directory) && path.dirname(candidate) === key(directory));

  const filesystem: SupervisedFilesystem = {
    readdir: vi.fn(async (directory: string) => {
      if (nodes.get(key(directory))?.type !== "dir") throw missing();
      return childrenOf(directory).map(([, node]) => ({
        name: node.name,
        isDirectory: () => node.type === "dir",
        isSymbolicLink: () => node.type === "symlink"
      }));
    }),
    lstat: vi.fn(async (target: string) => {
      const node = nodes.get(key(target));
      if (!node) throw missing();
      return { isDirectory: () => node.type === "dir", isSymbolicLink: () => node.type === "symlink" };
    }),
    realpath: vi.fn(async (target: string) => {
      const override = realpaths.get(key(target));
      if (override) return override;
      if (!nodes.has(key(target))) throw missing();
      return target;
    }),
    mkdir: vi.fn(async (target: string) => {
      mkdirCalls.push(target);
      if (nodes.has(key(target))) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      if (nodes.get(key(path.dirname(target)))?.type !== "dir") throw missing();
      put(target, "dir");
    }),
    rename: vi.fn(async (from: string, to: string) => {
      renameCalls.push([from, to]);
      const failure = renameFailures.get(key(from));
      if (failure) throw Object.assign(new Error(`private ${failure} C:\\Users\\Juli`), { code: failure });
      const node = nodes.get(key(from));
      if (!node) throw missing();
      if (nodes.has(key(to)) && key(to) !== key(from)) overwrites.push(to);
      const prefix = `${key(from)}${path.sep}`;
      for (const [candidate, descendant] of [...nodes.entries()]) {
        if (candidate.startsWith(prefix)) {
          nodes.delete(candidate);
          nodes.set(key(path.join(to, candidate.slice(prefix.length))), descendant);
        }
      }
      nodes.delete(key(from));
      nodes.set(key(to), { type: node.type, name: path.basename(to) });
    })
  };

  return {
    filesystem,
    renameCalls,
    mkdirCalls,
    overwrites,
    addDir: (target: string) => put(target, "dir"),
    addFile: (target: string) => put(target, "file"),
    addSymlink: (target: string) => put(target, "symlink"),
    remove: (target: string) => { nodes.delete(key(target)); },
    exists: (target: string) => nodes.has(key(target)),
    redirectRealpath: (target: string, destination: string) => { realpaths.set(key(target), destination); },
    failRenameFor: (target: string, code: string) => { renameFailures.set(key(target), code); }
  };
};

export type VirtualFilesystem = ReturnType<typeof createVirtualFilesystem>;
