import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@opperai/agents";
import { AgentFindingsSchema, type AgentFindings } from "./schemas.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, "..", "docs", "soc2");

function loadSOC2Reference(filename: string): string {
  return readFileSync(join(docsDir, filename), "utf-8");
}

const model = process.env.MODEL;
if (!model) throw new Error("MODEL environment variable is not set.");

function createAnalyzer(name: string, instructions: string): Agent<string, AgentFindings> {
  return new Agent<string, AgentFindings>({
    name: `${name}Analyzer`,
    instructions,
    tools: [],
    outputSchema: AgentFindingsSchema,
    model,
    maxIterations: 1,
  });
}

export function createSecurityAnalyzer() {
  return createAnalyzer("Security", `You are a SOC2 Security auditor (Common Criteria CC1-CC9). You will be given the full contents of a repository. Analyze it for security compliance.

Check for:
1. Secrets in code: Hardcoded API keys, passwords, tokens, private keys, connection strings
2. Authentication & authorization: Auth patterns, session management, access controls
3. Encryption: TLS/SSL configs, crypto library usage, encryption at rest
4. Dependency vulnerabilities: Outdated or known-vulnerable packages in dependency manifests
5. Branch protection: Whether the default branch has protection rules, required reviews, status checks
6. CI/CD security: GitHub Actions workflows — secret handling, pinned actions, permissions

For each finding, include the specific SOC2 section reference (e.g. "CC6.1", "CC7.2").

## SOC2 Reference
${loadSOC2Reference("security.md")}

Only report findings you can confirm from the provided code. Include file paths where applicable.
Return findings with severity levels and actionable recommendations.`);
}

export function createAvailabilityAnalyzer() {
  return createAnalyzer("Availability", `You are a SOC2 Availability auditor (Criteria A1). You will be given the full contents of a repository. Analyze it for availability compliance.

Check for:
1. Health check endpoints: Health/readiness/liveness probe implementations
2. Redundancy & scaling: K8s configs (replicas, HPA), load balancer configs, auto-scaling
3. Backup configurations: Database backup scripts, retention policies, snapshot configs
4. Monitoring & alerting: Monitoring setup (Prometheus, Datadog, CloudWatch, etc.)
5. Disaster recovery: DR documentation, runbooks, failover configs
6. CI/CD & deployment: Deployment pipelines, rollback strategies, blue-green/canary configs

For each finding, include the specific SOC2 section reference (e.g. "A1.1", "A1.2").

## SOC2 Reference
${loadSOC2Reference("availability.md")}

Only report findings you can confirm from the provided code. Include file paths where applicable.
Return findings with severity levels and actionable recommendations.`);
}

export function createProcessingIntegrityAnalyzer() {
  return createAnalyzer("ProcessingIntegrity", `You are a SOC2 Processing Integrity auditor (Criteria PI1). You will be given the full contents of a repository. Analyze it for processing integrity compliance.

Check for:
1. Input validation: Validation patterns, sanitization, schema validation (Zod, Joi, marshmallow, etc.)
2. Error handling: Proper error handling patterns, try/catch blocks, error logging
3. Data integrity: Checksums, data validation, schema migrations, type checking
4. Transaction handling: Database transactions, idempotency keys, retry logic
5. Test coverage: Test files, CI test steps, coverage configs
6. Quality gates: Linting, type checking, code review requirements in CI

For each finding, include the specific SOC2 section reference (e.g. "PI1.2", "PI1.3").

## SOC2 Reference
${loadSOC2Reference("processing-integrity.md")}

Only report findings you can confirm from the provided code. Include file paths where applicable.
Return findings with severity levels and actionable recommendations.`);
}

export function createConfidentialityAnalyzer() {
  return createAnalyzer("Confidentiality", `You are a SOC2 Confidentiality auditor (Criteria C1). You will be given the full contents of a repository. Analyze it for confidentiality compliance.

Check for:
1. Encryption at rest: Database encryption configs, encrypted storage, KMS usage
2. Encryption in transit: TLS/SSL configs, HTTPS enforcement, certificate management
3. Access controls: RBAC implementations, least-privilege patterns, API key scoping
4. Secret management: .gitignore for env files, vault/secret-manager integrations
5. Data classification: Data classification markers, sensitivity labels in code or docs
6. Repo visibility: Whether sensitive data could be exposed

For each finding, include the specific SOC2 section reference (e.g. "C1.1", "C1.2").

## SOC2 Reference
${loadSOC2Reference("confidentiality.md")}

Only report findings you can confirm from the provided code. Include file paths where applicable.
Return findings with severity levels and actionable recommendations.`);
}

export function createPrivacyAnalyzer() {
  return createAnalyzer("Privacy", `You are a SOC2 Privacy auditor (Criteria P1-P8). You will be given the full contents of a repository. Analyze it for privacy compliance.

Check for:
1. PII handling: Patterns handling email, SSN, phone, address, date of birth, names
2. Consent mechanisms: Consent flows, opt-in/opt-out implementations, cookie banners
3. Data retention: Data retention policies, TTL configs, deletion/purge logic
4. Privacy documentation: Privacy policies, GDPR/CCPA references, data processing agreements
5. PII in logs: Logging configurations for PII masking/redaction
6. Data minimization: Patterns of collecting only necessary data

For each finding, include the specific SOC2 section reference (e.g. "P1.1", "P4.3", "P8.1").

## SOC2 Reference
${loadSOC2Reference("privacy.md")}

Only report findings you can confirm from the provided code. Include file paths where applicable.
Return findings with severity levels and actionable recommendations.`);
}
