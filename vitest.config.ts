import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one live Postgres instance with no per-test
    // transactional isolation (fixtures are inserted/cleaned up directly via
    // app.db). Running test files in parallel lets one file's globally-visible
    // rows (e.g. active marketplace listings) leak into another file's
    // queries — e.g. the marketplace browse/sort assertions and the lazy
    // listing-expiry sweep are not scoped per seller account. Force files to
    // run sequentially so the shared DB state stays deterministic.
    fileParallelism: false,
  },
});
