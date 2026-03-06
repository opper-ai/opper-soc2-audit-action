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

type AgentFactory = (owner: string, repo: string, localPath: string) => Agent<string, AgentFindings>;

async function runAgent(
  factory: AgentFactory,
  name: string,
  owner: string,
  repo: string,
  localPath: string,
  parentSpanId: string,
): Promise<AgentFindings> {
  console.log(`  [${owner}/${repo}] Starting ${name} audit...`);
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

export async function runAudit(owner: string, repo: string): Promise<AgentFindings[]> {
  const localPath = cloneRepo(owner, repo);

  const client = createOpperClient(process.env.OPPER_API_KEY);
  const span = await client.createSpan({ name: `soc2-audit/${owner}/${repo}` });

  const agents = [
    { factory: createSecurityAgent, name: "Security" },
    { factory: createAvailabilityAgent, name: "Availability" },
    { factory: createProcessingIntegrityAgent, name: "Processing Integrity" },
    { factory: createConfidentialityAgent, name: "Confidentiality" },
    { factory: createPrivacyAgent, name: "Privacy" },
  ];

  console.log(`\nAuditing ${owner}/${repo} (${localPath}) — running ${agents.length} agents in parallel...`);

  const results = await Promise.all(
    agents.map(({ factory, name }) => runAgent(factory, name, owner, repo, localPath, span.id)),
  );

  await client.updateSpan(span.id, { repo: `${owner}/${repo}`, findings: results.flatMap((r) => r.findings).length });

  return results;
}
