import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const environmentPaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
];

for (const path of environmentPaths) {
  if (existsSync(path)) {
    config({ path, override: false });
    break;
  }
}

const parsedPort = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

export const env = {
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsedPort,
};
