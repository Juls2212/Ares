import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const createContentSecurityPolicy = (isDevelopment: boolean): string => {
  const scriptSources = isDevelopment ? "'self' 'unsafe-inline'" : "'self'";
  const styleSources = isDevelopment ? "'self' 'unsafe-inline'" : "'self'";
  const connectSources = isDevelopment
    ? "'self' ws://127.0.0.1:5173"
    : "'self'";

  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    `style-src ${styleSources}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join("; ");
};

export default defineConfig(({ command }) => {
  const isDevelopment = command === "serve";

  return {
    root: "src/renderer",
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "ares-content-security-policy",
        transformIndexHtml: {
          order: "pre",
          handler: (html) =>
            html.replace(
              "<!-- ARES_CONTENT_SECURITY_POLICY -->",
              `<meta http-equiv="Content-Security-Policy" content="${createContentSecurityPolicy(
                isDevelopment
              )}" />`
            )
        }
      }
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      headers: {
        "Content-Security-Policy": createContentSecurityPolicy(isDevelopment)
      },
      hmr: {
        host: "127.0.0.1",
        port: 5173
      }
    },
    build: {
      outDir: path.resolve(__dirname, ".vite/renderer/main_window")
    }
  };
});
