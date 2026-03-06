import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { spawnSync } from "node:child_process";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "vendor", "target", ".terraform", "coverage",
  ".cache", ".turbo", ".parcel-cache", ".nuxt", ".output",
]);

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".bmp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".lock", ".min.js", ".min.css",
  ".map",
]);

const MAX_FILE_SIZE = 100_000; // 100KB per file
const MAX_TOTAL_SIZE = 800_000; // ~800KB total context (~200k tokens)

interface RepoContext {
  tree: string;
  files: { path: string; content: string }[];
  repoSettings: string;
  totalSize: number;
  truncated: boolean;
}

function shouldSkipFile(name: string, ext: string): boolean {
  if (name.startsWith(".") && name !== ".github") return false; // allow dotfiles except .github
  if (SKIP_EXTENSIONS.has(ext)) return true;
  if (name.endsWith(".min.js") || name.endsWith(".min.css")) return true;
  return false;
}

function walkDir(dir: string, root: string, files: { path: string; size: number }[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, root, files);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (shouldSkipFile(entry.name, ext)) continue;
      try {
        const stat = statSync(fullPath);
        if (stat.size > 0 && stat.size <= MAX_FILE_SIZE) {
          files.push({ path: relative(root, fullPath), size: stat.size });
        }
      } catch {
        continue;
      }
    }
  }
}

function buildTree(filePaths: string[]): string {
  const lines: string[] = [];
  const dirs = new Set<string>();
  for (const p of filePaths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  const allPaths = [...dirs, ...filePaths].sort();
  for (const p of allPaths) {
    const depth = p.split("/").length - 1;
    const name = p.split("/").pop()!;
    const isDir = dirs.has(p);
    lines.push(`${"  ".repeat(depth)}${isDir ? name + "/" : name}`);
  }
  return lines.join("\n");
}

function fetchRepoSettings(owner: string, repo: string): string {
  const gh = (args: string[]): string => {
    const result = spawnSync("gh", ["api", ...args], { encoding: "utf8", timeout: 30_000 });
    if (result.error || result.status !== 0) return "";
    return result.stdout.trim();
  };

  const lines: string[] = [];

  const repoRaw = gh([`/repos/${owner}/${repo}`]);
  if (repoRaw) {
    try {
      const data = JSON.parse(repoRaw);
      lines.push(`Visibility: ${data.visibility ?? "unknown"}`);
      lines.push(`Default branch: ${data.default_branch ?? "unknown"}`);
      lines.push(`Has issues: ${data.has_issues ?? false}`);
      lines.push(`Has wiki: ${data.has_wiki ?? false}`);

      const branch = data.default_branch ?? "main";
      const bpRaw = gh([`/repos/${owner}/${repo}/branches/${branch}/protection`]);
      if (bpRaw) {
        try {
          const bp = JSON.parse(bpRaw);
          lines.push("Branch protection: enabled");
          lines.push(`  Required reviews: ${bp.required_pull_request_reviews != null}`);
          lines.push(`  Required status checks: ${bp.required_status_checks != null}`);
          lines.push(`  Enforce admins: ${bp.enforce_admins?.enabled ?? false}`);
        } catch {
          lines.push("Branch protection: error parsing response");
        }
      } else {
        lines.push("Branch protection: not configured");
      }
    } catch {
      lines.push("Repository settings: error parsing response");
    }
  }

  return lines.join("\n");
}

export function loadRepoContext(owner: string, repo: string, localPath: string): RepoContext {
  const allFiles: { path: string; size: number }[] = [];
  walkDir(localPath, localPath, allFiles);

  // Sort by size ascending so we fit more files
  allFiles.sort((a, b) => a.size - b.size);

  const files: { path: string; content: string }[] = [];
  let totalSize = 0;
  let truncated = false;

  for (const f of allFiles) {
    if (totalSize + f.size > MAX_TOTAL_SIZE) {
      truncated = true;
      continue;
    }
    try {
      const content = readFileSync(join(localPath, f.path), "utf-8");
      files.push({ path: f.path, content });
      totalSize += f.size;
    } catch {
      continue;
    }
  }

  const tree = buildTree(allFiles.map((f) => f.path));
  const repoSettings = fetchRepoSettings(owner, repo);

  return { tree, files, repoSettings, totalSize, truncated };
}

export function formatContext(ctx: RepoContext): string {
  const sections: string[] = [];

  sections.push("## Repository Settings\n");
  sections.push(ctx.repoSettings || "(unable to fetch)");
  sections.push("");

  sections.push("## File Tree\n");
  sections.push("```");
  sections.push(ctx.tree);
  sections.push("```");
  sections.push("");

  if (ctx.truncated) {
    sections.push(`> Note: Repository exceeds context limit. ${ctx.files.length} files included (${Math.round(ctx.totalSize / 1024)}KB). Some larger files were omitted.\n`);
  }

  sections.push("## File Contents\n");
  for (const f of ctx.files) {
    sections.push(`### ${f.path}\n`);
    sections.push("```");
    sections.push(f.content);
    sections.push("```");
    sections.push("");
  }

  return sections.join("\n");
}
