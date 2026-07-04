import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Match the tsconfig "@/*" → project-root alias so tests can import app modules
// the same way the app does. Environment defaults to node (fast) for the pure
// lib tests; component tests opt into jsdom via a `// @vitest-environment jsdom`
// docblock at the top of the file.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
