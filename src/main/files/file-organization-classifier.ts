import path from "node:path";
import type { OrganizationCategory } from "../../shared/file-contracts";

const categoryFolderNames: Record<OrganizationCategory, string> = {
  DOCUMENTS: "Documentos",
  IMAGES: "Imágenes",
  AUDIO: "Audio",
  VIDEOS: "Videos",
  ARCHIVES: "Comprimidos",
  OTHER: "Otros"
};

const extensionCategories: Record<string, OrganizationCategory> = {
  pdf: "DOCUMENTS",
  doc: "DOCUMENTS",
  docx: "DOCUMENTS",
  odt: "DOCUMENTS",
  rtf: "DOCUMENTS",
  txt: "DOCUMENTS",
  csv: "DOCUMENTS",
  xls: "DOCUMENTS",
  xlsx: "DOCUMENTS",
  ppt: "DOCUMENTS",
  pptx: "DOCUMENTS",
  jpg: "IMAGES",
  jpeg: "IMAGES",
  png: "IMAGES",
  gif: "IMAGES",
  bmp: "IMAGES",
  webp: "IMAGES",
  tiff: "IMAGES",
  mp3: "AUDIO",
  wav: "AUDIO",
  flac: "AUDIO",
  m4a: "AUDIO",
  aac: "AUDIO",
  ogg: "AUDIO",
  mp4: "VIDEOS",
  mov: "VIDEOS",
  avi: "VIDEOS",
  mkv: "VIDEOS",
  wmv: "VIDEOS",
  webm: "VIDEOS",
  zip: "ARCHIVES",
  rar: "ARCHIVES",
  "7z": "ARCHIVES",
  tar: "ARCHIVES",
  gz: "ARCHIVES",
  bz2: "ARCHIVES"
};

export const getOrganizationCategoryFolderName = (category: OrganizationCategory): string =>
  categoryFolderNames[category];

export const classifyFileForOrganization = (fileName: string): OrganizationCategory => {
  const extension = path.win32.extname(fileName).slice(1).toLocaleLowerCase("en-US");
  return extensionCategories[extension] ?? "OTHER";
};

export const isOrganizationCategoryFolderName = (name: string): boolean =>
  Object.values(categoryFolderNames).some(
    (folderName) => folderName.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US")
  );
