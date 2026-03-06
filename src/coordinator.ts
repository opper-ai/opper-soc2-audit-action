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
import {
  createSecurityAnalyzer,
  createAvailabilityAnalyzer,
  createProcessingIntegrityAnalyzer,
  createConfidentialityAnalyzer,
  createPrivacyAnalyzer,
} from "./analyzers.ts";
import { loadRepoContext, formatContext } from "./context.ts";

export type AuditMode = "agent" | "full-context";

type AgentFactory = (owner: string, repo: string, localPath: string) => Agent<string, AgentFindings>;
type AnalyzerFactory = () => Agent<string, AgentFindings>;

async function runAgent(
  factory: AgentFactory,
  name: string,
  owner: string,
  repo: string,
  localPath: string,
  parentSpanId: string,
): Promise<AgentFindings> {
  console.log(`  [${owner}/${repo}] Starting ${name} audit (agent mode)...`);
  const agent = factory(owner, repo, localPath);

  agent.registerHook(HookEvents.BeforeTool, ({ tool, input }: { tool: { name: string }; input?: unknown }) => {
    console.log(`  [${owner}/${repo}/${name}] ${tool.name}`, JSON.stringify(input ?? {}).slice(0, 100));
  });

  try {
    const { result } = await agent.run(
      `Audit the GitHub repository ${owner}/${repo} for SOC2 ${name} compliance. Use owner="${owner}" and repo="${repo}" when calling tools.`,
      parentSpanId,
    );
    console.log(`  [${owner}/${repo}] ${name}: ${result.findings.length} findings`);
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  [${owner}/${repo}] ${name} agent error: ${msg}`);
    return {
      criteria: name,
      control_reference: "N/A",
      summary: `Agent error: ${msg.slice(0, 200)}`,
      findings: [],
    };
  }
}

async function runAnalyzer(
  factory: AnalyzerFactory,
  name: string,
  owner: string,
  repo: string,
  context: string,
  parentSpanId: string,
): Promise<AgentFindings> {
  console.log(`  [${owner}/${repo}] Starting ${name} audit (full-context mode)...`);
  const analyzer = factory();

  try {
    const { result } = await analyzer.run(
      `Audit the GitHub repository ${owner}/${repo} for SOC2 ${name} compliance.\n\n${context}`,
      parentSpanId,
    );
    console.log(`  [${owner}/${repo}] ${name}: ${result.findings.length} findings`);
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  [${owner}/${repo}] ${name} analyzer error: ${msg}`);
    return {
      criteria: name,
      control_reference: "N/A",
      summary: `Analyzer error: ${msg.slice(0, 200)}`,
      findings: [],
    };
  }
}

export async function runAudit(owner: string, repo: string, mode: AuditMode = "agent"): Promise<AgentFindings[]> {
  const localPath = cloneRepo(owner, repo);

  const client = createOpperClient(process.env.OPPER_API_KEY);
  const span = await client.createSpan({ name: `soc2-audit/${owner}/${repo}` });

  let results: AgentFindings[];

  if (mode === "full-context") {
    console.log(`\nLoading full repository context for ${owner}/${repo}...`);
    const ctx = loadRepoContext(owner, repo, localPath);
    const context = formatContext(ctx);
    console.log(`  Context: ${ctx.files.length} files, ${Math.round(ctx.totalSize / 1024)}KB${ctx.truncated ? " (truncated)" : ""}`);

    const analyzers = [
      { factory: createSecurityAnalyzer, name: "Security" },
      { factory: createAvailabilityAnalyzer, name: "Availability" },
      { factory: createProcessingIntegrityAnalyzer, name: "Processing Integrity" },
      { factory: createConfidentialityAnalyzer, name: "Confidentiality" },
      { factory: createPrivacyAnalyzer, name: "Privacy" },
    ];

    console.log(`Auditing ${owner}/${repo} — running ${analyzers.length} analyzers in parallel (full-context)...`);

    results = await Promise.all(
      analyzers.map(({ factory, name }) => runAnalyzer(factory, name, owner, repo, context, span.id)),
    );
  } else {
    const agents = [
      { factory: createSecurityAgent, name: "Security" },
      { factory: createAvailabilityAgent, name: "Availability" },
      { factory: createProcessingIntegrityAgent, name: "Processing Integrity" },
      { factory: createConfidentialityAgent, name: "Confidentiality" },
      { factory: createPrivacyAgent, name: "Privacy" },
    ];

    console.log(`\nAuditing ${owner}/${repo} (${localPath}) — running ${agents.length} agents in parallel...`);

    results = await Promise.all(
      agents.map(({ factory, name }) => runAgent(factory, name, owner, repo, localPath, span.id)),
    );
  }

  await client.updateSpan(span.id, { repo: `${owner}/${repo}`, mode, findings: results.flatMap((r) => r.findings).length });

  return results;
}
