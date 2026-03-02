import { test } from "node:test";
import assert from "node:assert/strict";
import { issueTitle, issueBody, slugify } from "./issues.ts";

test("issueTitle formats correctly", () => {
  assert.equal(
    issueTitle("CC6.1", "Hardcoded API key in source"),
    "[SOC2] CC6.1: Hardcoded API key in source"
  );
});

test("issueBody includes key fields", () => {
  const body = issueBody({
    category: "Security",
    severity: "critical",
    title: "Hardcoded API key",
    description: "Found API key in config.ts",
    file_path: "src/config.ts",
    recommendation: "Use environment variables",
    soc2_reference: "CC6.1 - Logical Access Controls",
  });
  assert.ok(body.includes("CC6.1"));
  assert.ok(body.includes("src/config.ts"));
  assert.ok(body.includes("Use environment variables"));
  assert.ok(body.includes("critical"));
});

test("slugify produces clean slug", () => {
  assert.equal(slugify("Hardcoded API key in source!"), "hardcoded-api-key-in-source");
  assert.equal(slugify("  spaces  "), "spaces");
});
