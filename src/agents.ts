import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@opperai/agents";
import { AgentFindingsSchema, type AgentFindings } from "./schemas.ts";
import { createTools } from "./tools.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, "..", "docs", "soc2");

function loadSOC2Reference(filename: string): string {
  return readFileSync(join(docsDir, filename), "utf-8");
}

const model = process.env.MODEL;
if (!model) throw new Error("MODEL environment variable is not set. Set MODEL to an Opper model identifier (e.g. gcp/claude-sonnet-4.5-eu).");

const contextModel = process.env.CONTEXT_MODEL || model;

const CONTEXT_METHODOLOGY = `
## Methodology

You have been given the full repository contents above. Focus exclusively on analyzing the code provided.
Do NOT use any tools — everything you need is in the context.
Base your findings only on what you can see in the source code.
Only report findings you can directly confirm from the provided code.`;

const AGENT_METHODOLOGY = `
## Research methodology

Work in depth, not just breadth:
1. Start by listing the root directory to understand the repo structure
2. Use search_code to find relevant patterns — results include matching lines with context
3. When search results look suspicious or interesting, use read_file to read the full file for confirmation
4. Use read_file with start_line/end_line to paginate large files — the response header tells you the total line count
5. Follow the evidence: if a config file references another file, read that file too
6. Do not report a finding based on a filename alone — verify by reading the content

Only report findings you have actually confirmed by reading the relevant code or config.`;

interface AgentOptions {
  owner: string;
  repo: string;
  localPath: string;
  repoContext?: string;
}

interface AgentConfig {
  name: string;
  checklist: string;
  soc2File: string;
  toolKeys: (keyof ReturnType<typeof createTools>)[];
}

const AGENT_CONFIGS: AgentConfig[] = [
  {
    name: "Security",
    checklist: `Check for:
1. Secrets in code: Search for hardcoded API keys, passwords, tokens, private keys, connection strings
2. Authentication & authorization: Look for auth patterns, session management, access controls
3. Encryption: Check for TLS/SSL configs, crypto library usage, encryption at rest
4. Dependency vulnerabilities: Review dependency manifests for outdated or known-vulnerable packages
5. Branch protection: Check if the default branch has protection rules, required reviews, status checks
6. CI/CD security: Review GitHub Actions workflows for secret handling, pinned actions, permissions

For each finding, include the specific SOC2 section reference (e.g. "CC6.1", "CC7.2") from the reference below.`,
    soc2File: "security.md",
    toolKeys: ["listRepoFiles", "readFile", "searchCode", "getRepoSettings", "listWorkflows", "listDependencies"],
  },
  {
    name: "Availability",
    checklist: `Check for:
1. Health check endpoints: Look for health/readiness/liveness probe implementations
2. Redundancy & scaling: Check for K8s configs (replicas, HPA), load balancer configs, auto-scaling
3. Backup configurations: Look for database backup scripts, retention policies, snapshot configs
4. Monitoring & alerting: Check for monitoring setup (Prometheus, Datadog, CloudWatch, etc.)
5. Disaster recovery: Look for DR documentation, runbooks, failover configs
6. CI/CD & deployment: Check for deployment pipelines, rollback strategies, blue-green/canary configs

For each finding, include the specific SOC2 section reference (e.g. "A1.1", "A1.2") from the reference below.`,
    soc2File: "availability.md",
    toolKeys: ["listRepoFiles", "readFile", "searchCode", "listWorkflows"],
  },
  {
    name: "ProcessingIntegrity",
    checklist: `Check for:
1. Input validation: Look for validation patterns, sanitization, schema validation (Zod, Joi, marshmallow, etc.)
2. Error handling: Check for proper error handling patterns, try/catch blocks, error logging
3. Data integrity: Look for checksums, data validation, schema migrations, type checking
4. Transaction handling: Check for database transactions, idempotency keys, retry logic
5. Test coverage: Review test files, CI test steps, coverage configs
6. Quality gates: Check for linting, type checking, code review requirements in CI

For each finding, include the specific SOC2 section reference (e.g. "PI1.2", "PI1.3") from the reference below.`,
    soc2File: "processing-integrity.md",
    toolKeys: ["listRepoFiles", "readFile", "searchCode", "listWorkflows"],
  },
  {
    name: "Confidentiality",
    checklist: `Check for:
1. Encryption at rest: Look for database encryption configs, encrypted storage, KMS usage
2. Encryption in transit: Check for TLS/SSL configs, HTTPS enforcement, certificate management
3. Access controls: Look for RBAC implementations, least-privilege patterns, API key scoping
4. Secret management: Check .gitignore for env files, look for vault/secret-manager integrations
5. Data classification: Look for data classification markers, sensitivity labels in code or docs
6. Repo visibility: Check if the repo is public/private, if sensitive data could be exposed

For each finding, include the specific SOC2 section reference (e.g. "C1.1", "C1.2") from the reference below.`,
    soc2File: "confidentiality.md",
    toolKeys: ["listRepoFiles", "readFile", "searchCode", "getRepoSettings"],
  },
  {
    name: "Privacy",
    checklist: `Check for:
1. PII handling: Search for patterns handling email, SSN, phone, address, date of birth, names
2. Consent mechanisms: Look for consent flows, opt-in/opt-out implementations, cookie banners
3. Data retention: Check for data retention policies, TTL configs, deletion/purge logic
4. Privacy documentation: Look for privacy policies, GDPR/CCPA references, data processing agreements
5. PII in logs: Check logging configurations for PII masking/redaction
6. Data minimization: Look for patterns of collecting only necessary data

For each finding, include the specific SOC2 section reference (e.g. "P1.1", "P4.3", "P8.1") from the reference below.`,
    soc2File: "privacy.md",
    toolKeys: ["listRepoFiles", "readFile", "searchCode"],
  },
];

function createAgentFromConfig(config: AgentConfig, { owner, repo, localPath, repoContext }: AgentOptions): Agent<string, AgentFindings> {
  const hasContext = !!repoContext;
  const allTools = createTools(owner, repo, localPath);
  const criteriaLabel = config.name.replace(/([a-z])([A-Z])/g, "$1 $2");

  if (hasContext) {
    return new Agent<string, AgentFindings>({
      name: `${config.name}Analyzer`,
      instructions: `You are a SOC2 ${criteriaLabel} auditor. Analyze the repository code provided in the prompt.

${config.checklist}

## SOC2 Reference
${loadSOC2Reference(config.soc2File)}

${CONTEXT_METHODOLOGY}
Return findings with severity levels and actionable recommendations.`,
      tools: [],
      outputSchema: AgentFindingsSchema,
      model: contextModel,
      maxIterations: 1,
    });
  }

  return new Agent<string, AgentFindings>({
    name: `${config.name}Agent`,
    instructions: `You are a SOC2 ${criteriaLabel} auditor. Audit the GitHub repository for compliance.

${config.checklist}

## SOC2 Reference
${loadSOC2Reference(config.soc2File)}

Use owner="${owner}" and repo="${repo}" for all tool calls.
${AGENT_METHODOLOGY}
Return findings with severity levels and actionable recommendations.`,
    tools: config.toolKeys.map((k) => allTools[k]),
    outputSchema: AgentFindingsSchema,
    model,
    maxIterations: 30,
  });
}

export function createSecurityAgent(opts: AgentOptions) { return createAgentFromConfig(AGENT_CONFIGS[0], opts); }
export function createAvailabilityAgent(opts: AgentOptions) { return createAgentFromConfig(AGENT_CONFIGS[1], opts); }
export function createProcessingIntegrityAgent(opts: AgentOptions) { return createAgentFromConfig(AGENT_CONFIGS[2], opts); }
export function createConfidentialityAgent(opts: AgentOptions) { return createAgentFromConfig(AGENT_CONFIGS[3], opts); }
export function createPrivacyAgent(opts: AgentOptions) { return createAgentFromConfig(AGENT_CONFIGS[4], opts); }
