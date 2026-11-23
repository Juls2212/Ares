import path from "node:path";

export type FilePathStats = {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

const normalizeForComparison = (targetPath: string): string => {
  const normalized = path.win32.normalize(targetPath).replace(/[\\/]+$/, "");
  return normalized.toLocaleLowerCase("en-US");
};

export const isCanonicalPathWithinRoot = (rootPath: string, targetPath: string): boolean => {
  const root = normalizeForComparison(rootPath);
  const target = normalizeForComparison(targetPath);
  return target === root || target.startsWith(`${root}\\`);
};
