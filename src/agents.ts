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

const CONTEXT_METHODOLOGY = `
## Methodology

You have been given the full repository contents above. Analyze what you can see directly.
Use tools only when you need to:
- Check GitHub API settings (branch protection, repo visibility) via get_repo_settings
- Search for specific patterns you want to verify via search_code
- Read files that were too large to include in the context via read_file

Do NOT use tools to re-read files already provided in the context — that wastes time.
Only report findings you can confirm from the code or API data.`;

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

function methodology(hasContext: boolean): string {
  return hasContext ? CONTEXT_METHODOLOGY : AGENT_METHODOLOGY;
}

function maxIter(hasContext: boolean): number {
  return hasContext ? 10 : 30;
}

export function createSecurityAgent({ owner, repo, localPath, repoContext }: AgentOptions) {
  const { listRepoFiles, readFile, searchCode, getRepoSettings, listWorkflows, listDependencies } = createTools(owner, repo, localPath);
  const hasContext = !!repoContext;
  return new Agent<string, AgentFindings>({
    name: "SecurityAgent",
    instructions: `You are a SOC2 Security auditor (Common Criteria CC1-CC9). Audit the GitHub repository for security compliance.

Check for:
1. Secrets in code: Search for hardcoded API keys, passwords, tokens, private keys, connection strings
2. Authentication & authorization: Look for auth patterns, session management, access controls
3. Encryption: Check for TLS/SSL configs, crypto library usage, encryption at rest
4. Dependency vulnerabilities: Review dependency manifests for outdated or known-vulnerable packages
5. Branch protection: Check if the default branch has protection rules, required reviews, status checks
6. CI/CD security: Review GitHub Actions workflows for secret handling, pinned actions, permissions

For each finding, include the specific SOC2 section reference (e.g. "CC6.1", "CC7.2") from the reference below.

## SOC2 Reference
${loadSOC2Reference("security.md")}

Use owner="${owner}" and repo="${repo}" for all tool calls.
${methodology(hasContext)}
Return findings with severity levels and actionable recommendations.`,
    tools: [listRepoFiles, readFile, searchCode, getRepoSettings, listWorkflows, listDependencies],
    outputSchema: AgentFindingsSchema,
    model,
    maxIterations: maxIter(hasContext),
  });
}

export function createAvailabilityAgent({ owner, repo, localPath, repoContext }: AgentOptions) {
  const { listRepoFiles, readFile, searchCode, listWorkflows } = createTools(owner, repo, localPath);
  const hasContext = !!repoContext;
  return new Agent<string, AgentFindings>({
    name: "AvailabilityAgent",
    instructions: `You are a SOC2 Availability auditor (Criteria A1). Audit the GitHub repository for availability compliance.

Check for:
1. Health check endpoints: Look for health/readiness/liveness probe implementations
2. Redundancy & scaling: Check for K8s configs (replicas, HPA), load balancer configs, auto-scaling
3. Backup configurations: Look for database backup scripts, retention policies, snapshot configs
4. Monitoring & alerting: Check for monitoring setup (Prometheus, Datadog, CloudWatch, etc.)
5. Disaster recovery: Look for DR documentation, runbooks, failover configs
6. CI/CD & deployment: Check for deployment pipelines, rollback strategies, blue-green/canary configs

For each finding, include the specific SOC2 section reference (e.g. "A1.1", "A1.2") from the reference below.

## SOC2 Reference
${loadSOC2Reference("availability.md")}

Use owner="${owner}" and repo="${repo}" for all tool calls.
${methodology(hasContext)}
Return findings with severity levels and actionable recommendations.`,
    tools: [listRepoFiles, readFile, searchCode, listWorkflows],
    outputSchema: AgentFindingsSchema,
    model,
    maxIterations: maxIter(hasContext),
  });
}

export function createProcessingIntegrityAgent({ owner, repo, localPath, repoContext }: AgentOptions) {
  const { listRepoFiles, readFile, searchCode, listWorkflows } = createTools(owner, repo, localPath);
  const hasContext = !!repoContext;
  return new Agent<string, AgentFindings>({
    name: "ProcessingIntegrityAgent",
    instructions: `You are a SOC2 Processing Integrity auditor (Criteria PI1). Audit the GitHub repository for processing integrity compliance.

Check for:
1. Input validation: Look for validation patterns, sanitization, schema validation (Zod, Joi, marshmallow, etc.)
2. Error handling: Check for proper error handling patterns, try/catch blocks, error logging
3. Data integrity: Look for checksums, data validation, schema migrations, type checking
4. Transaction handling: Check for database transactions, idempotency keys, retry logic
5. Test coverage: Review test files, CI test steps, coverage configs
6. Quality gates: Check for linting, type checking, code review requirements in CI

For each finding, include the specific SOC2 section reference (e.g. "PI1.2", "PI1.3") from the reference below.

## SOC2 Reference
${loadSOC2Reference("processing-integrity.md")}

Use owner="${owner}" and repo="${repo}" for all tool calls.
${methodology(hasContext)}
Return findings with severity levels and actionable recommendations.`,
    tools: [listRepoFiles, readFile, searchCode, listWorkflows],
    outputSchema: AgentFindingsSchema,
    model,
    maxIterations: maxIter(hasContext),
  });
}

export function createConfidentialityAgent({ owner, repo, localPath, repoContext }: AgentOptions) {
  const { listRepoFiles, readFile, searchCode, getRepoSettings } = createTools(owner, repo, localPath);
  const hasContext = !!repoContext;
  return new Agent<string, AgentFindings>({
    name: "ConfidentialityAgent",
    instructions: `You are a SOC2 Confidentiality auditor (Criteria C1). Audit the GitHub repository for confidentiality compliance.

Check for:
1. Encryption at rest: Look for database encryption configs, encrypted storage, KMS usage
2. Encryption in transit: Check for TLS/SSL configs, HTTPS enforcement, certificate management
3. Access controls: Look for RBAC implementations, least-privilege patterns, API key scoping
4. Secret management: Check .gitignore for env files, look for vault/secret-manager integrations
5. Data classification: Look for data classification markers, sensitivity labels in code or docs
6. Repo visibility: Check if the repo is public/private, if sensitive data could be exposed

For each finding, include the specific SOC2 section reference (e.g. "C1.1", "C1.2") from the reference below.

## SOC2 Reference
${loadSOC2Reference("confidentiality.md")}

Use owner="${owner}" and repo="${repo}" for all tool calls.
${methodology(hasContext)}
Return findings with severity levels and actionable recommendations.`,
    tools: [listRepoFiles, readFile, searchCode, getRepoSettings],
    outputSchema: AgentFindingsSchema,
    model,
    maxIterations: maxIter(hasContext),
  });
}

export function createPrivacyAgent({ owner, repo, localPath, repoContext }: AgentOptions) {
  const { listRepoFiles, readFile, searchCode } = createTools(owner, repo, localPath);
  const hasContext = !!repoContext;
  return new Agent<string, AgentFindings>({
    name: "PrivacyAgent",
    instructions: `You are a SOC2 Privacy auditor (Criteria P1-P8). Audit the GitHub repository for privacy compliance.

Check for:
1. PII handling: Search for patterns handling email, SSN, phone, address, date of birth, names
2. Consent mechanisms: Look for consent flows, opt-in/opt-out implementations, cookie banners
3. Data retention: Check for data retention policies, TTL configs, deletion/purge logic
4. Privacy documentation: Look for privacy policies, GDPR/CCPA references, data processing agreements
5. PII in logs: Check logging configurations for PII masking/redaction
6. Data minimization: Look for patterns of collecting only necessary data

For each finding, include the specific SOC2 section reference (e.g. "P1.1", "P4.3", "P8.1") from the reference below.

## SOC2 Reference
${loadSOC2Reference("privacy.md")}

Use owner="${owner}" and repo="${repo}" for all tool calls.
${methodology(hasContext)}
Return findings with severity levels and actionable recommendations.`,
    tools: [listRepoFiles, readFile, searchCode],
    outputSchema: AgentFindingsSchema,
    model,
    maxIterations: maxIter(hasContext),
  });
}
