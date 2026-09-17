import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "./src/main/config/database-environment";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/main/database/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: getDatabaseUrl()
  }
});
