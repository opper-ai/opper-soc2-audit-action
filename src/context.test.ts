import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRepoContext, formatContext } from "./context.ts";

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

describe("loadRepoContext", () => {
  it("loads text files and skips node_modules and binaries", () => {
    const dir = setupTestRepo();
    const ctx = loadRepoContext("test", "repo", dir);
    const paths = ctx.files.map((f) => f.path);
    assert.ok(paths.includes("README.md"));
    assert.ok(paths.includes("index.ts"));
    assert.ok(paths.includes("src/app.ts"));
    assert.ok(!paths.includes("node_modules/bad.js"));
    assert.ok(!paths.includes("image.png"));
  });

  it("builds a file tree", () => {
    const dir = setupTestRepo();
    const ctx = loadRepoContext("test", "repo", dir);
    assert.ok(ctx.tree.includes("src/"));
    assert.ok(ctx.tree.includes("index.ts"));
  });
});

describe("formatContext", () => {
  it("produces markdown with file contents", () => {
    const dir = setupTestRepo();
    const ctx = loadRepoContext("test", "repo", dir);
    const output = formatContext(ctx);
    assert.ok(output.includes("## File Tree"));
    assert.ok(output.includes("## File Contents"));
    assert.ok(output.includes("### index.ts"));
    assert.ok(output.includes('console.log("hello")'));
  });
});
