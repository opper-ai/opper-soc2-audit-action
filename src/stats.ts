import type { AgentFindings, Severity } from "./schemas.ts";

export interface AuditStats {
  categoriesChecked: number;
  totalFindings: number;
  severityCounts: Record<Severity, number>;
  riskLevel: string;
  categoryBreakdown: { category: string; count: number }[];
}

export function computeStats(repo: string, allFindings: AgentFindings[]): AuditStats {
  const severityCounts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  for (const af of allFindings) {
    for (const f of af.findings) {
      severityCounts[f.severity]++;
    }
  }

  const totalFindings = Object.values(severityCounts).reduce((a, b) => a + b, 0);

  let riskLevel = "Low";
  if (severityCounts.critical > 0) riskLevel = "Critical";
  else if (severityCounts.high > 0) riskLevel = "High";
  else if (severityCounts.medium > 0) riskLevel = "Medium";

  const categoryCounts = new Map<string, number>();
  for (const af of allFindings) {
    const existing = categoryCounts.get(af.criteria) ?? 0;
    categoryCounts.set(af.criteria, existing + af.findings.length);
  }

  const categoryBreakdown = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    categoriesChecked: categoryCounts.size,
    totalFindings,
    severityCounts,
    riskLevel,
    categoryBreakdown,
  };
}

export function formatStats(stats: AuditStats): string {
  const lines: string[] = [
    "",
    "---",
    "## Audit Stats",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Categories checked | ${stats.categoriesChecked} |`,
    `| Total findings | ${stats.totalFindings} |`,
    `| Risk level | **${stats.riskLevel}** |`,
    "",
    "### Findings by Severity",
    "",
    "| Severity | Count |",
    "|----------|-------|",
  ];

  for (const sev of ["critical", "high", "medium", "low", "info"] as const) {
    const count = stats.severityCounts[sev];
    if (count > 0) {
      lines.push(`| ${sev.charAt(0).toUpperCase() + sev.slice(1)} | ${count} |`);
    }
  }

  if (stats.categoryBreakdown.length > 0) {
    lines.push("");
    lines.push("### Findings by Category");
    lines.push("");
    lines.push("| Category | Findings |");
    lines.push("|----------|----------|");
    for (const { category, count } of stats.categoryBreakdown) {
      lines.push(`| ${category} | ${count} |`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
