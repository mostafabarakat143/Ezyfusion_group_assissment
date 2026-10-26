import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig, env } from "prisma/config";

// Graders copy .env.example → .env.local. Prefer that over a local .env.
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
