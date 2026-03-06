import { appendFileSync, writeFileSync } from "fs";
import { join } from "node:path";
import { parseRepoArg, cloneRepo } from "./tools.ts";
import { runAudit, type AuditMode } from "./coordinator.ts";
import { generateReport } from "./report.ts";
import { computeStats, formatStats } from "./stats.ts";
import type { AgentFindings } from "./schemas.ts";
import { createOrUpdateIssues } from "./issues.ts";
import { attemptFix } from "./fix.ts";
import { createOpperClient } from "@opperai/agents";

async function main() {
  const repoArg = process.env.VALIDATED_REPO ?? process.argv[2];

  if (!repoArg || !repoArg.includes("/")) {
    console.error("Usage: tsx src/main.ts owner/repo");
    console.error("Example: tsx src/main.ts opper-ai/opperai-agent-sdk");
    console.error("\nRequired env vars: OPPER_API_KEY, GITHUB_TOKEN (for gh CLI)");
    process.exit(1);
  }

  const [owner, repo] = parseRepoArg(repoArg);
  const auditMode = (process.env.AUDIT_MODE === "full-context" ? "full-context" : "agent") as AuditMode;
  const allFindings = await runAudit(owner, repo, auditMode);

  const repoName = `${owner}/${repo}`;
  const stats = computeStats(repoName, allFindings);
  const report = generateReport(repoName, allFindings, stats);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `soc2-report-${timestamp}.md`;
  const outputDir = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, report);
  console.log(`\nReport saved to ${filepath}`);
  console.log(report);

  const statsSummary = formatStats(stats);
  console.log(statsSummary);

  // Write to GitHub Actions step summary if running in CI
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n" + statsSummary + "\n");
  }

  // Write stats as GitHub Actions outputs if running in CI
  if (process.env.GITHUB_OUTPUT) {
    const outputLines = [
      `total-findings=${stats.totalFindings}`,
      `critical=${stats.severityCounts.critical}`,
      `high=${stats.severityCounts.high}`,
      `medium=${stats.severityCounts.medium}`,
      `low=${stats.severityCounts.low}`,
      `risk-level=${stats.riskLevel}`,
      `categories-checked=${stats.categoriesChecked}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, outputLines.join("\n") + "\n");
  }

  // Auto-issue and auto-fix
  const createIssues = process.env.CREATE_ISSUES === "true";
  const autoFix = process.env.AUTO_FIX === "true";

  if (createIssues || autoFix) {
    const client = createOpperClient(process.env.OPPER_API_KEY);
    const span = await client.createSpan({ name: "soc2-audit/post-processing" });
    const localPath = cloneRepo(owner, repo);

    for (const agentFindings of allFindings) {
      const actionable = agentFindings.findings.filter(
        (f) => f.severity === "critical" || f.severity === "high"
      );
      if (actionable.length === 0) continue;

      const issueMap = await createOrUpdateIssues(owner, repo, actionable, agentFindings.control_reference);

      if (autoFix) {
        for (const finding of actionable) {
          if (!finding.file_path) continue;
          const issueNumber = issueMap.get(finding.title);
          if (!issueNumber) continue;
          await attemptFix(owner, repo, localPath, finding, issueNumber, span.id);
        }
      }
    }
  }
}

main();
