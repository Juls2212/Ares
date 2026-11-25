import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";

import packageJson from "./package.json";
import { EXECUTABLE_NAME, PRODUCT_NAME, SETUP_EXE_NAME, SQUIRREL_PACKAGE_NAME } from "./src/main/app-identity";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // The folder and the executable keep the existing name (ares-desktop) so scripts and docs stay valid;
    // the user-facing name "Ares" comes from the Windows file metadata and the Squirrel title below.
    executableName: EXECUTABLE_NAME,
    win32metadata: {
      ProductName: PRODUCT_NAME,
      FileDescription: PRODUCT_NAME,
      InternalName: EXECUTABLE_NAME,
      OriginalFilename: `${EXECUTABLE_NAME}.exe`
    },
    // Copied next to the asar (process.resourcesPath), flat by file name. PGlite cannot find its own data files
    // once it is bundled into main.js, so Main reads them from here (src/main/database/pglite-assets.mjs).
    extraResource: [
      "./drizzle",
      "./node_modules/@electric-sql/pglite/dist/pglite.wasm",
      "./node_modules/@electric-sql/pglite/dist/initdb.wasm",
      "./node_modules/@electric-sql/pglite/dist/pglite.data"
    ]
  },
  makers: [
    new MakerSquirrel({
      // Letters only: it becomes the install folder and part of the shortcut AppUserModelID (see app-identity.ts).
      name: SQUIRREL_PACKAGE_NAME,
      title: PRODUCT_NAME,
      exe: `${EXECUTABLE_NAME}.exe`,
      // Fixed, so the permanent link releases/latest/download/Ares-Setup.exe never changes.
      setupExe: SETUP_EXE_NAME,
      noMsi: true,
      authors: packageJson.author || PRODUCT_NAME,
      description: packageJson.description
    }),
    new MakerZIP({}, ["win32"])
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts"
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts"
        }
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts"
        }
      ]
    })
  ]
};

export default config;
