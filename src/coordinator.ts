import { HookEvents, createOpperClient } from "@opperai/agents";
import type { Agent } from "@opperai/agents";
import type { AgentFindings } from "./schemas.ts";
import { cloneRepo } from "./tools.ts";
import {
  createSecurityAgent,
  createAvailabilityAgent,
  createProcessingIntegrityAgent,
  createConfidentialityAgent,
  createPrivacyAgent,
} from "./agents.ts";
import { loadRepoContext, formatContext } from "./context.ts";

export type AuditMode = "agent" | "full-context";

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
  owner: string,
  repo: string,
  localPath: string,
  parentSpanId: string,
  repoContext?: string,
): Promise<AgentFindings> {
  const mode = repoContext ? "full-context" : "agent";
  console.log(`  [${owner}/${repo}] Starting ${def.name} audit (${mode})...`);

  const agent = def.factory({ owner, repo, localPath, repoContext });

  agent.registerHook(HookEvents.BeforeTool, ({ tool, input }: { tool: { name: string }; input?: unknown }) => {
    console.log(`  [${owner}/${repo}/${def.name}] ${tool.name}`, JSON.stringify(input ?? {}).slice(0, 100));
  });

  const prompt = repoContext
    ? `Audit the GitHub repository ${owner}/${repo} for SOC2 ${def.name} compliance.\n\n# Repository Contents\n\n${repoContext}`
    : `Audit the GitHub repository ${owner}/${repo} for SOC2 ${def.name} compliance. Use owner="${owner}" and repo="${repo}" when calling tools.`;

  try {
    const { result } = await agent.run(prompt, parentSpanId);
    console.log(`  [${owner}/${repo}] ${def.name}: ${result.findings.length} findings`);
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  [${owner}/${repo}] ${def.name} error: ${msg}`);
    return {
      criteria: def.name,
      control_reference: "N/A",
      summary: `Error: ${msg.slice(0, 200)}`,
      findings: [],
    };
  }
}

export async function runAudit(owner: string, repo: string, mode: AuditMode = "agent"): Promise<AgentFindings[]> {
  const localPath = cloneRepo(owner, repo);

  const client = createOpperClient(process.env.OPPER_API_KEY);
  const span = await client.createSpan({ name: `soc2-audit/${owner}/${repo}` });

  let repoContext: string | undefined;
  if (mode === "full-context") {
    console.log(`\nLoading full repository context for ${owner}/${repo}...`);
    const ctx = loadRepoContext(owner, repo, localPath);
    repoContext = formatContext(ctx);
    console.log(`  Context: ${ctx.files.length} files, ${Math.round(ctx.totalSize / 1024)}KB${ctx.truncated ? " (truncated)" : ""}`);
  }

  console.log(`\nAuditing ${owner}/${repo} — running ${AGENTS.length} agents in parallel (${mode})...`);

  const results = await Promise.all(
    AGENTS.map((def) => runOne(def, owner, repo, localPath, span.id, repoContext)),
  );

  await client.updateSpan(span.id, { repo: `${owner}/${repo}`, mode, findings: results.flatMap((r) => r.findings).length });

  return results;
}
