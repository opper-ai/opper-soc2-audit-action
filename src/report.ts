import type { AgentFindings, Finding, Severity } from "./schemas.ts";
import type { AuditStats } from "./stats.ts";
import { computeStats } from "./stats.ts";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n|\r/g, " ");
}

export function generateReport(repo: string, allFindings: AgentFindings[], stats?: AuditStats): string {
  const { riskLevel, totalFindings } = stats ?? computeStats(repo, allFindings);
  const today = new Date().toISOString().split("T")[0];

  const lines: string[] = [
    `# SOC2 Compliance Report`,
    ``,
    `**Repository:** ${repo}`,
    `**Date:** ${today}`,
    `**Overall Risk Level:** ${riskLevel}`,
    `**Total Findings:** ${totalFindings}`,
    ``,
    `## Executive Summary`,
    ``,
  ];

  for (const af of allFindings) {
    lines.push(`- **${mdCell(af.criteria)}** (${mdCell(af.control_reference)}): ${mdCell(af.summary)} (${af.findings.length} findings)`);
  }
  lines.push("");

  lines.push("## Findings by Trust Service Criteria");
  lines.push("");
  renderFindings(lines, allFindings, 3);

  lines.push("## Summary");
  lines.push("");
  lines.push("| Criteria | Critical | High | Medium | Low | Info |");
  lines.push("|----------|----------|------|--------|-----|------|");
  for (const af of allFindings) {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of af.findings) c[f.severity]++;
    lines.push(`| ${mdCell(af.criteria)} | ${c.critical} | ${c.high} | ${c.medium} | ${c.low} | ${c.info} |`);
  }
  lines.push("");

  lines.push("## Top Recommendations");
  lines.push("");
  const allF: Finding[] = allFindings.flatMap((af) => af.findings);
  allF.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  for (let i = 0; i < Math.min(10, allF.length); i++) {
    const f = allF[i];
    lines.push(`${i + 1}. **[${f.severity.toUpperCase()}]** ${mdCell(f.recommendation)} (${mdCell(f.category)})`);
  }
  lines.push("");

  return lines.join("\n");
}

function renderFindings(lines: string[], findings: AgentFindings[], headingLevel: number): void {
  const prefix = "#".repeat(headingLevel);
  for (const af of findings) {
    lines.push(`${prefix} ${mdCell(af.criteria)} (${mdCell(af.control_reference)})`);
    lines.push("");
    lines.push(`_${mdCell(af.summary)}_`);
    lines.push("");

    if (af.findings.length === 0) {
      lines.push("No findings.");
      lines.push("");
      continue;
    }

    lines.push("| Severity | SOC2 Ref | Finding | File | Recommendation |");
    lines.push("|----------|----------|---------|------|----------------|");
    const sorted = [...af.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const f of sorted) {
      const sev = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
      const file = f.file_path ? `\`${f.file_path.replace(/`/g, "'")}\`` : "-";
      const ref = mdCell(f.soc2_reference ?? "-");
      lines.push(`| ${sev} | ${ref} | **${mdCell(f.title)}**: ${mdCell(f.description)} | ${file} | ${mdCell(f.recommendation)} |`);
    }
    lines.push("");
  }
}
