import { HookEvents, createOpperClient } from "@opperai/agents";
import type { Agent } from "@opperai/agents";
import type { AgentFindings, Finding } from "./schemas.ts";
import { cloneRepo } from "./tools.ts";
import {
  createSecurityAgent,
  createAvailabilityAgent,
  createProcessingIntegrityAgent,
  createConfidentialityAgent,
  createPrivacyAgent,
} from "./agents.ts";
import { loadRepoContext, formatContext } from "./context.ts";

interface AgentDef {
  factory: (opts: { owner: string; repo: string; localPath: string; repoContext?: string }) => Agent<string, AgentFindings>;
  name: string;
}

const AGENTS: AgentDef[] = [
  { factory: createSecurityAgent, name: "Security" },
  { factory: createAvailabilityAgent, name: "Availability" },
  { factory: createProcessingIntegrityAgent, name: "Processing Integrity" },
  { factory: createConfidentialityAgent, name: "Confidentiality" },
  { factory: createPrivacyAgent, name: "Privacy" },
];

async function runOne(
  def: AgentDef,
  mode: string,
  owner: string,
  repo: string,
  localPath: string,
  parentSpanId: string,
  repoContext?: string,
): Promise<AgentFindings> {
  console.log(`  [${owner}/${repo}] Starting ${def.name} audit (${mode})...`);

  const agent = def.factory({ owner, repo, localPath, repoContext });

  agent.registerHook(HookEvents.BeforeTool, ({ tool, input }: { tool: { name: string }; input?: unknown }) => {
    console.log(`  [${owner}/${repo}/${def.name}/${mode}] ${tool.name}`, JSON.stringify(input ?? {}).slice(0, 100));
  });

  const prompt = repoContext
    ? `Audit the GitHub repository ${owner}/${repo} for SOC2 ${def.name} compliance.\n\n# Repository Contents\n\n${repoContext}`
    : `Audit the GitHub repository ${owner}/${repo} for SOC2 ${def.name} compliance. Use owner="${owner}" and repo="${repo}" when calling tools.`;

  try {
    const { result } = await agent.run(prompt, parentSpanId);
    console.log(`  [${owner}/${repo}] ${def.name} (${mode}): ${result.findings.length} findings`);
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  [${owner}/${repo}] ${def.name} (${mode}) error: ${msg}`);
    return {
      criteria: def.name,
      control_reference: "N/A",
      summary: `Error: ${msg.slice(0, 200)}`,
      findings: [],
    };
  }
}

/** Deduplicate findings by title+file_path, keeping the higher severity. */
function mergeFindings(a: AgentFindings, b: AgentFindings): AgentFindings {
  const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const seen = new Map<string, Finding>();

  for (const f of [...a.findings, ...b.findings]) {
    const key = `${f.title}::${f.file_path ?? ""}`;
    const existing = seen.get(key);
    if (!existing || SEVERITY_RANK[f.severity] < SEVERITY_RANK[existing.severity]) {
      seen.set(key, f);
    }
  }

  return {
    criteria: a.criteria,
    control_reference: a.control_reference || b.control_reference,
    summary: [a.summary, b.summary].filter(Boolean).join(" | "),
    findings: [...seen.values()],
  };
}

export async function runAudit(owner: string, repo: string): Promise<AgentFindings[]> {
  const localPath = cloneRepo(owner, repo);

  const client = createOpperClient(process.env.OPPER_API_KEY);
  const span = await client.createSpan({ name: `soc2-audit/${owner}/${repo}` });

  // Load full repo context for the full-context pass
  console.log(`\nLoading full repository context for ${owner}/${repo}...`);
  const ctx = loadRepoContext(owner, repo, localPath);
  const repoContext = formatContext(ctx);
  console.log(`  Context: ${ctx.files.length} files, ${Math.round(ctx.totalSize / 1024)}KB${ctx.truncated ? " (truncated)" : ""}`);

  console.log(`\nAuditing ${owner}/${repo} — running ${AGENTS.length} agents × 2 modes in parallel...`);

  // Run both modes for all agents in parallel
  const allPromises = AGENTS.flatMap((def) => [
    runOne(def, "deep", owner, repo, localPath, span.id, undefined),
    runOne(def, "context", owner, repo, localPath, span.id, repoContext),
  ]);

  const allResults = await Promise.all(allPromises);

  // Merge findings from both modes per criteria
  const merged: AgentFindings[] = AGENTS.map((def, i) => {
    const deep = allResults[i * 2];
    const context = allResults[i * 2 + 1];
    const result = mergeFindings(deep, context);
    console.log(`  [${owner}/${repo}] ${def.name}: ${deep.findings.length} (deep) + ${context.findings.length} (context) → ${result.findings.length} merged`);
    return result;
  });

  const totalFindings = merged.flatMap((r) => r.findings).length;
  await client.updateSpan(span.id, { repo: `${owner}/${repo}`, mode: "dual", findings: totalFindings });

  return merged;
}
