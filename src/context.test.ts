import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRepoChunks } from "./context.ts";

function setupTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "soc2-ctx-test-"));
  writeFileSync(join(dir, "README.md"), "# Test repo\n");
  writeFileSync(join(dir, "index.ts"), 'console.log("hello");\n');
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "app.ts"), 'export const x = 1;\n');
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "bad.js"), "should be skipped");
  writeFileSync(join(dir, "image.png"), "binary data");
  return dir;
}

describe("loadRepoChunks", () => {
  it("loads text files and skips node_modules and binaries", () => {
    const dir = setupTestRepo();
    const chunks = loadRepoChunks(dir);
    assert.strictEqual(chunks.length, 1);
    const paths = chunks[0].files.map((f) => f.path);
    assert.ok(paths.includes("README.md"));
    assert.ok(paths.includes("index.ts"));
    assert.ok(paths.includes("src/app.ts"));
    assert.ok(!paths.includes("node_modules/bad.js"));
    assert.ok(!paths.includes("image.png"));
  });

  it("small repo fits in a single chunk", () => {
    const dir = setupTestRepo();
    const chunks = loadRepoChunks(dir);
    assert.strictEqual(chunks.length, 1);
    assert.ok(chunks[0].formatted.includes("## File Tree"));
    assert.ok(chunks[0].formatted.includes("## File Contents"));
    assert.ok(chunks[0].formatted.includes('console.log("hello")'));
  });

  it("splits large repos into multiple chunks", () => {
    const dir = mkdtempSync(join(tmpdir(), "soc2-ctx-split-"));
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "a", "big1.txt"), "x".repeat(500_000));
    writeFileSync(join(dir, "b", "big2.txt"), "y".repeat(500_000));

    const chunks = loadRepoChunks(dir);
    assert.ok(chunks.length >= 2, `expected >= 2 chunks, got ${chunks.length}`);

    const allPaths = chunks.flatMap((c) => c.files.map((f) => f.path));
    assert.ok(allPaths.includes("a/big1.txt"));
    assert.ok(allPaths.includes("b/big2.txt"));
  });

  it("keeps folder contents together when splitting", () => {
    const dir = mkdtempSync(join(tmpdir(), "soc2-ctx-dirs-"));
    mkdirSync(join(dir, "alpha"));
    mkdirSync(join(dir, "beta"));
    writeFileSync(join(dir, "alpha", "one.ts"), "a".repeat(500_000));
    writeFileSync(join(dir, "alpha", "small.ts"), "small file");
    writeFileSync(join(dir, "beta", "two.ts"), "b".repeat(500_000));

    const chunks = loadRepoChunks(dir);
    // alpha files should be in the same chunk
    for (const chunk of chunks) {
      const paths = chunk.files.map((f) => f.path);
      if (paths.includes("alpha/one.ts")) {
        assert.ok(paths.includes("alpha/small.ts"), "alpha/ files should stay together");
      }
    }
  });
});
