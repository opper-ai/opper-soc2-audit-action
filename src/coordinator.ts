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
import { loadRepoChunks, type ContextChunk } from "./context.ts";

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
  console.log(`  [${owner}/${repo}] Starting ${def.name} (${mode})...`);

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

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Deduplicate findings by title+file_path, keeping the higher severity. */
function deduplicateFindings(allFindings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of allFindings) {
    const key = `${f.title}::${f.file_path ?? ""}`;
    const existing = seen.get(key);
    if (!existing || SEVERITY_RANK[f.severity] < SEVERITY_RANK[existing.severity]) {
      seen.set(key, f);
    }
  }
  return [...seen.values()];
}

/** Merge multiple AgentFindings for the same criteria into one. */
function mergeResults(name: string, results: AgentFindings[]): AgentFindings {
  const allFindings = results.flatMap((r) => r.findings);
  return {
    criteria: name,
    control_reference: results.find((r) => r.control_reference !== "N/A")?.control_reference ?? "N/A",
    summary: results.map((r) => r.summary).filter(Boolean).join(" | "),
    findings: deduplicateFindings(allFindings),
  };
}

export async function runAudit(owner: string, repo: string): Promise<AgentFindings[]> {
  const localPath = cloneRepo(owner, repo);

  const client = createOpperClient(process.env.OPPER_API_KEY);
  const span = await client.createSpan({ name: `soc2-audit/${owner}/${repo}` });

  // Load and split repo into context chunks
  console.log(`\nLoading repository ${owner}/${repo}...`);
  const chunks = loadRepoChunks(localPath);
  console.log(`  Split into ${chunks.length} chunk(s)`);
  for (const chunk of chunks) {
    console.log(`    ${chunk.label}: ${chunk.files.length} files, ${Math.round(chunk.totalSize / 1024)}KB`);
  }

  // For each criteria: run deep agent + one context analyzer per chunk, all in parallel
  const allPromises: { criteria: string; promise: Promise<AgentFindings> }[] = [];

  for (const def of AGENTS) {
    // Deep research agent (tools, no context)
    allPromises.push({
      criteria: def.name,
      promise: runOne(def, "deep", owner, repo, localPath, span.id),
    });

    // Context analyzer per chunk (no tools, full code)
    for (const chunk of chunks) {
      allPromises.push({
        criteria: def.name,
        promise: runOne(def, `context/${chunk.label}`, owner, repo, localPath, span.id, chunk.formatted),
      });
    }
  }

  console.log(`\nRunning ${allPromises.length} agents in parallel (${AGENTS.length} deep + ${AGENTS.length} × ${chunks.length} context)...`);

  const allResults = await Promise.all(allPromises.map((p) => p.promise));

  // Group results by criteria and merge
  const merged: AgentFindings[] = AGENTS.map((def) => {
    const indices = allPromises
      .map((p, i) => (p.criteria === def.name ? i : -1))
      .filter((i) => i !== -1);
    const results = indices.map((i) => allResults[i]);
    const result = mergeResults(def.name, results);
    const deepCount = results[0].findings.length;
    const contextCount = results.slice(1).reduce((sum, r) => sum + r.findings.length, 0);
    console.log(`  ${def.name}: ${deepCount} (deep) + ${contextCount} (context) → ${result.findings.length} merged`);
    return result;
  });

  const totalFindings = merged.flatMap((r) => r.findings).length;
  await client.updateSpan(span.id, { repo: `${owner}/${repo}`, chunks: chunks.length, findings: totalFindings });

  return merged;
}
