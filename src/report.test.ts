import { describe, it } from "node:test";
import assert from "node:assert";
import { generateReport } from "./report.ts";
import type { AgentFindings } from "./schemas.ts";

describe("generateReport", () => {
  it("generates report with findings", () => {
    const findings: AgentFindings[] = [
      {
        criteria: "Security",
        control_reference: "CC6/CC7",
        summary: "Found some issues.",
        findings: [
          {
            category: "Security",
            severity: "critical",
            title: "Hardcoded API key",
            description: "API key found in source code",
            file_path: "src/config.ts",
            recommendation: "Move to environment variable",
            soc2_reference: "CC6.1 - Logical and Physical Access Controls",
          },
        ],
      },
    ];
    const report = generateReport("owner/repo", findings);
    assert.ok(report.includes("# SOC2 Compliance Report"));
    assert.ok(report.includes("**Repository:** owner/repo"));
    assert.ok(report.includes("Hardcoded API key"));
    assert.ok(report.includes("Critical"));
    assert.ok(report.includes("CC6.1"));
    assert.ok(report.includes("SOC2 Ref"));
  });

  it("handles empty findings", () => {
    const findings: AgentFindings[] = [
      {
        criteria: "Security",
        control_reference: "CC6/CC7",
        summary: "No issues found.",
        findings: [],
      },
    ];
    const report = generateReport("owner/repo", findings);
    assert.ok(report.includes("No findings"));
  });
});
