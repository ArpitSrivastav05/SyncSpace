import { createApp } from "./app.js";

/**
 * Server entrypoint — binds the Express app to a port.
 *
 * Separated from app.ts so integration tests can import the app
 * without binding a real port.
 */

const app = createApp();
const port = parseInt(process.env["PORT"] ?? "3000", 10);

app.listen(port, () => {
  console.log(`🚀 SyncSpace backend listening on port ${port}`);
  console.log(`   Environment: ${process.env["NODE_ENV"] ?? "development"}`);
  console.log(`   Health check: http://localhost:${port}/api/health`);
});
