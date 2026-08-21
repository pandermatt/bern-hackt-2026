import type { Config } from "drizzle-kit";

export default {
  dialect: "sqlite",
  schema: "./db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/app.db",
  },
} satisfies Config;
