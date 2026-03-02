import { describe, it, test } from "node:test";
import assert from "node:assert";
import assert_strict from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRepoArg, createTools } from "./tools.ts";

describe("parseRepoArg", () => {
  it("parses valid owner/repo", () => {
    const [owner, repo] = parseRepoArg("opper-ai/sdk");
    assert.strictEqual(owner, "opper-ai");
    assert.strictEqual(repo, "sdk");
  });

  it("throws on invalid format", () => {
    assert.throws(() => parseRepoArg("invalid"), /Invalid repo/);
  });
});

test("searchAndReplace replaces content in file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "soc2-test-"));
  writeFileSync(join(dir, "config.ts"), 'const apiKey = "hardcoded-secret-123";\n');
  const tools = createTools("owner", "repo", dir);
  const toolResult = await (tools.searchAndReplace as any).execute({
    owner: "owner",
    repo: "repo",
    path: "config.ts",
    old_string: '"hardcoded-secret-123"',
    new_string: 'process.env.API_KEY ?? ""',
  });
  const result = toolResult.output;
  assert_strict.equal(result, "OK");
  const content = readFileSync(join(dir, "config.ts"), "utf-8");
  assert_strict.ok(content.includes("process.env.API_KEY"));
  assert_strict.ok(!content.includes("hardcoded-secret-123"));
});

test("searchAndReplace returns error if old_string not found", async () => {
  const dir = mkdtempSync(join(tmpdir(), "soc2-test-"));
  writeFileSync(join(dir, "config.ts"), 'const x = 1;\n');
  const tools = createTools("owner", "repo", dir);
  const toolResult = await (tools.searchAndReplace as any).execute({
    owner: "owner", repo: "repo",
    path: "config.ts", old_string: "not-there", new_string: "something",
  });
  const result = toolResult.output;
  assert_strict.ok(result.startsWith("ERROR:"));
});

test("searchAndReplace returns error if old_string appears multiple times", async () => {
  const dir = mkdtempSync(join(tmpdir(), "soc2-test-"));
  writeFileSync(join(dir, "config.ts"), 'const x = "foo"; const y = "foo";\n');
  const tools = createTools("owner", "repo", dir);
  const toolResult = await (tools.searchAndReplace as any).execute({
    owner: "owner", repo: "repo",
    path: "config.ts", old_string: '"foo"', new_string: '"bar"',
  });
  const result = toolResult.output;
  assert_strict.ok(result.startsWith("ERROR:"));
});

test("searchAndReplace returns error if file not found", async () => {
  const dir = mkdtempSync(join(tmpdir(), "soc2-test-"));
  const tools = createTools("owner", "repo", dir);
  const toolResult = await (tools.searchAndReplace as any).execute({
    owner: "owner", repo: "repo",
    path: "nonexistent.ts", old_string: "x", new_string: "y",
  });
  const result = toolResult.output;
  assert_strict.ok(result.startsWith("ERROR:"));
});
