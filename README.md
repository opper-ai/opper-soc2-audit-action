# SOC2 Compliance Audit

AI-powered SOC2 compliance auditor for GitHub repositories. Runs five specialized agents that check your repo against SOC2 Trust Service Criteria and produce a detailed findings report.

## What it checks

| Agent | SOC2 Criteria | Examples |
|-------|--------------|----------|
| Security | CC1–CC9 | Hardcoded secrets, branch protection, CI/CD security, dependency vulnerabilities |
| Availability | A1 | Health checks, redundancy, backups, monitoring, disaster recovery |
| Processing Integrity | PI1 | Input validation, error handling, test coverage, quality gates |
| Confidentiality | C1 | Encryption at rest/transit, access controls, secret management |
| Privacy | P1–P8 | PII handling, consent, data retention, GDPR/CCPA compliance |

## Quick start

Add this workflow to your repo at `.github/workflows/soc2-audit.yml`:

```yaml
name: SOC2 Compliance Audit

on:
  schedule:
    - cron: "0 7 * * 1"  # Every Monday at 07:00 UTC
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: opper-ai/opper-soc2-audit-action@main
        with:
          opper-api-key: ${{ secrets.OPPER_API_KEY }}
```

### Setup

1. Get an API key from [Opper](https://opper.ai)
2. Add `OPPER_API_KEY` as a repository secret (Settings > Secrets and variables > Actions)
3. Trigger the workflow manually or wait for the weekly schedule

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `opper-api-key` | Yes | — | Opper API key for the LLM agents |
| `github-token` | No | `github.token` | GitHub token with read access to the repo |
| `model` | No | `gcp/claude-sonnet-4.5-eu` | Opper model identifier for the agents |
| `upload-artifact` | No | `true` | Upload the report as a workflow artifact |
| `create-issues` | No | `false` | Create/update GitHub Issues for critical and high findings |
| `auto-fix` | No | `false` | Attempt code fixes via Opper agent and open PRs (implies `create-issues`) |

## Outputs

| Output | Description |
|--------|-------------|
| `report-path` | Path to the generated markdown report |
| `total-findings` | Total number of findings |
| `critical` | Number of critical-severity findings |
| `high` | Number of high-severity findings |
| `medium` | Number of medium-severity findings |
| `low` | Number of low-severity findings |
| `risk-level` | Overall risk level (`Critical`, `High`, `Medium`, `Low`) |
| `categories-checked` | Number of SOC2 categories checked |

## Examples

### Fail the workflow on critical findings

```yaml
- uses: opper-ai/opper-soc2-audit-action@main
  id: audit
  with:
    opper-api-key: ${{ secrets.OPPER_API_KEY }}

- if: steps.audit.outputs.critical != '0'
  run: |
    echo "::error::${{ steps.audit.outputs.critical }} critical findings detected"
    exit 1
```

### Auto-create issues and fix PRs

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write

steps:
  - uses: opper-ai/opper-soc2-audit-action@main
    with:
      opper-api-key: ${{ secrets.OPPER_API_KEY }}
      auto-fix: "true"
```

### Use a different model

```yaml
- uses: opper-ai/opper-soc2-audit-action@main
  with:
    opper-api-key: ${{ secrets.OPPER_API_KEY }}
    model: "anthropic/claude-sonnet-4"
```

### Skip artifact upload

```yaml
- uses: opper-ai/opper-soc2-audit-action@main
  id: audit
  with:
    opper-api-key: ${{ secrets.OPPER_API_KEY }}
    upload-artifact: "false"

- run: cat ${{ steps.audit.outputs.report-path }}
```

## Local usage

```bash
export OPPER_API_KEY="your-key"
export GITHUB_TOKEN="your-token"
npm ci
npx tsx src/main.ts owner/repo
```

Override the model:

```bash
MODEL="anthropic/claude-sonnet-4" npx tsx src/main.ts owner/repo
```

## Report

The audit produces a markdown report with:

- Executive summary with overall risk level
- Findings grouped by SOC2 Trust Service Criteria
- Severity ratings (Critical / High / Medium / Low / Info)
- Specific SOC2 section references (e.g. CC6.1, A1.2)
- Actionable recommendations ranked by severity
- Summary table and audit stats

Reports are uploaded as workflow artifacts and written to the GitHub Actions step summary.

## License

MIT
