import { spawnSync } from "child_process";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFunctionTool } from "@opperai/agents";
import { z } from "zod";

export function parseRepoArg(arg: string): [string, string] {
  const parts = arg.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: ${arg}. Expected owner/repo`);
  }
  return [parts[0], parts[1]];
}

export function cloneRepo(owner: string, repo: string): string {
  const currentRepo = process.env.GITHUB_REPOSITORY;
  if (`${owner}/${repo}` === currentRepo && process.env.GITHUB_WORKSPACE) {
    const wsPath = process.env.GITHUB_WORKSPACE;
    if (existsSync(join(wsPath, ".git"))) return wsPath;
  }

  const tmpDir = join(tmpdir(), `soc2-audit-${owner}-${repo}`);
  if (existsSync(tmpDir)) return tmpDir;

  console.log(`  Cloning ${owner}/${repo}...`);
  const token = process.env.GITHUB_TOKEN;
  const url = token
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}`
    : `https://github.com/${owner}/${repo}`;

  const result = spawnSync("git", ["clone", "--depth=1", url, tmpDir], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to clone ${owner}/${repo}: ${(result.stderr ?? "").trim()}`);
  }
  return tmpDir;
}

function gh(args: string[], { silent = false }: { silent?: boolean } = {}): string {
  const result = spawnSync("gh", ["api", ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) return `ERROR: ${result.error.message}`;
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    if (!silent) console.warn(`[gh api] Error (status ${result.status}): ${stderr || "unknown error"}`);
    return `ERROR: ${stderr || "unknown error"}`;
  }
  return result.stdout.trim();
}

export function createTools(owner: string, repo: string, localPath: string) {
  const listRepoFiles = createFunctionTool(
    ({ path }: { owner: string; repo: string; path: string }) => {
      const dir = join(localPath, path);
      if (!existsSync(dir)) return `ERROR: path not found: ${path}`;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        return entries
          .map((e) => `[${e.isDirectory() ? "dir" : "file"}] ${join(path, e.name)}`)
          .join("\n") || "(empty directory)";
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    {
      name: "list_repo_files",
      description: "List files and directories at a path in the repository.",
      schema: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("Directory path (empty string for root)"),
      }),
    },
  );

  const readFile = createFunctionTool(
    ({ path, start_line, end_line }: { owner: string; repo: string; path: string; start_line?: number; end_line?: number }) => {
      const filepath = join(localPath, path);
      if (!existsSync(filepath)) return `ERROR: file not found: ${path}`;
      try {
        const lines = readFileSync(filepath, "utf-8").split("\n");
        const total = lines.length;
        const from = Math.max(1, start_line ?? 1);
        const to = Math.min(total, end_line ?? from + 399); // default: 400 lines per read
        const slice = lines.slice(from - 1, to).join("\n");
        const header = `[Lines ${from}-${to} of ${total}]${to < total ? " — use start_line/end_line to read more" : ""}`;
        return `${header}\n${slice}`;
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    {
      name: "read_file",
      description: "Read lines from a file. Returns 400 lines by default. Use start_line/end_line to paginate large files. The response header shows total line count.",
      schema: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path within the repository"),
        start_line: z.number().optional().describe("First line to read (1-based, default: 1)"),
        end_line: z.number().optional().describe("Last line to read (inclusive, default: start_line + 399)"),
      }),
    },
  );

  const searchCode = createFunctionTool(
    ({ query }: { owner: string; repo: string; query: string }) => {
      const result = spawnSync(
        "grep",
        ["-r", "-n", "-i", "-C", "3", "--include=*.*", "-m", "5", query, localPath],
        { encoding: "utf8", timeout: 30_000 },
      );
      if (result.error) return `ERROR: ${result.error.message}`;
      const output = (result.stdout ?? "").trim();
      if (!output) return "No results found.";
      // Strip the local path prefix from file references
      return output.replace(new RegExp(localPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/", "g"), "");
    },
    {
      name: "search_code",
      description: "Search for code patterns using case-insensitive regex. Returns matching lines with 3 lines of surrounding context (up to 5 matches per file). Supports full grep regex syntax — use specific patterns for better signal (e.g. 'api[_-]?key\\s*=', 'password\\s*=\\s*[\"\\']', '-----BEGIN (RSA|EC)').",
      schema: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        query: z.string().describe("Regex search pattern (e.g. 'api[_-]?key', 'password\\s*=\\s*[\"\\']', '-----BEGIN (RSA|EC)')"),
      }),
    },
  );

  const getRepoSettings = createFunctionTool(
    ({ owner: o, repo: r }: { owner: string; repo: string }) => {
      const repoRaw = gh([`/repos/${o}/${r}`]);
      if (repoRaw.startsWith("ERROR:")) return repoRaw;
      try {
        const data = JSON.parse(repoRaw);
        const lines = [
          `Visibility: ${data.visibility ?? "unknown"}`,
          `Default branch: ${data.default_branch ?? "unknown"}`,
          `Has issues: ${data.has_issues ?? false}`,
          `Has wiki: ${data.has_wiki ?? false}`,
        ];
        const branch = data.default_branch ?? "main";
        const bpRaw = gh([`/repos/${o}/${r}/branches/${branch}/protection`], { silent: true });
        if (bpRaw.startsWith("ERROR:")) {
          lines.push("Branch protection: not configured");
        } else {
          const bp = JSON.parse(bpRaw);
          lines.push("Branch protection: enabled");
          lines.push(`  Required reviews: ${bp.required_pull_request_reviews != null}`);
          lines.push(`  Required status checks: ${bp.required_status_checks != null}`);
          lines.push(`  Enforce admins: ${bp.enforce_admins?.enabled ?? false}`);
        }
        return lines.join("\n");
      } catch {
        return repoRaw.slice(0, 2000);
      }
    },
    {
      name: "get_repo_settings",
      description: "Get repository settings including branch protection, visibility, and security features.",
      schema: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
      }),
    },
  );

  const listWorkflows = createFunctionTool(
    (_: { owner: string; repo: string }) => {
      const workflowsDir = join(localPath, ".github", "workflows");
      if (!existsSync(workflowsDir)) return "No GitHub Actions workflows found.";
      try {
        const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
        if (files.length === 0) return "No GitHub Actions workflows found.";
        return files
          .map((f) => {
            const content = readFileSync(join(workflowsDir, f), "utf-8");
            const truncated = content.length > 5_000 ? content.slice(0, 5_000) + "\n... [truncated]" : content;
            return `--- .github/workflows/${f} ---\n${truncated}`;
          })
          .join("\n\n");
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    {
      name: "list_workflows",
      description: "List GitHub Actions workflows and read their configurations.",
      schema: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
      }),
    },
  );

  const listDependencies = createFunctionTool(
    (_: { owner: string; repo: string }) => {
      const manifests = ["package.json", "requirements.txt", "go.mod", "pyproject.toml", "Gemfile", "pom.xml"];
      const results: string[] = [];
      for (const manifest of manifests) {
        const filepath = join(localPath, manifest);
        if (!existsSync(filepath)) continue;
        try {
          const content = readFileSync(filepath, "utf-8");
          results.push(`--- ${manifest} ---\n${content.slice(0, 2000)}`);
        } catch {
          continue;
        }
      }
      return results.length > 0 ? results.join("\n\n") : "No recognized dependency manifests found.";
    },
    {
      name: "list_dependencies",
      description: "List dependencies by reading package manifests (package.json, requirements.txt, go.mod, etc.).",
      schema: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
      }),
    },
  );

  const searchAndReplace = createFunctionTool(
    ({ path, old_string, new_string }: { owner: string; repo: string; path: string; old_string: string; new_string: string }) => {
      const filepath = join(localPath, path);
      if (!filepath.startsWith(localPath + "/")) return `ERROR: path escapes repository root: ${path}`;
      if (!existsSync(filepath)) return `ERROR: file not found: ${path}`;
      try {
        const content = readFileSync(filepath, "utf-8");
        const count = content.split(old_string).length - 1;
        if (count === 0) return `ERROR: old_string not found in ${path}`;
        if (count > 1) return `ERROR: old_string is not unique in ${path} (${count} occurrences found)`;
        const updated = content.replace(old_string, new_string);
        writeFileSync(filepath, updated, "utf-8");
        return "OK";
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    {
      name: "search_and_replace",
      description: "Replace an exact string in a file. Use this to apply targeted fixes. Returns 'OK' on success or an error message.",
      schema: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path within the repository"),
        old_string: z.string().describe("Exact string to find and replace. Must appear exactly once in the file."),
        new_string: z.string().describe("Replacement string"),
      }),
    },
  );

  return { listRepoFiles, readFile, searchCode, getRepoSettings, listWorkflows, listDependencies, searchAndReplace };
}
