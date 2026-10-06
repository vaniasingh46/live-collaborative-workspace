import { env } from "./env.js";
import { createWorkspaceServer } from "./app.js";

const workspace = createWorkspaceServer();

void workspace.initialize().then(() => workspace.httpServer.listen(env.port, () => {
  console.info(`Server listening on http://localhost:${env.port}`);
})).catch((error: unknown) => {
  console.error("Unable to initialize local workspace storage.");
  if (env.nodeEnv !== "production") console.error(error);
  process.exitCode = 1;
});
