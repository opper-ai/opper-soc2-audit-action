import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

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

const MAX_CHUNK_SIZE = 800_000; // ~800KB per chunk (~200k tokens)

export interface RepoFile {
  path: string;
  content: string;
  size: number;
}

export interface ContextChunk {
  label: string;
  files: RepoFile[];
  totalSize: number;
  formatted: string;
}

function shouldSkipFile(name: string, ext: string): boolean {
  if (SKIP_EXTENSIONS.has(ext)) return true;
  if (name.endsWith(".min.js") || name.endsWith(".min.css")) return true;
  return false;
}

function walkDir(dir: string, root: string, files: RepoFile[]): void {
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
        if (stat.size > 0) {
          const content = readFileSync(fullPath, "utf-8");
          const relPath = relative(root, fullPath);
          files.push({ path: relPath, content, size: stat.size });
        }
      } catch {
        continue;
      }
    }
  }
}

function totalSize(files: RepoFile[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

function topDir(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Split files into two groups by top-level directory, keeping folders intact. */
function splitByDir(files: RepoFile[]): [RepoFile[], RepoFile[]] {
  // Group by top-level directory (root files go under "")
  const groups = new Map<string, RepoFile[]>();
  for (const f of files) {
    const dir = topDir(f.path);
    const list = groups.get(dir) ?? [];
    list.push(f);
    groups.set(dir, list);
  }

  const dirs = [...groups.keys()];

  // If only one group (all files in same dir or all at root), split the file list in half
  if (dirs.length <= 1) {
    const mid = Math.ceil(files.length / 2);
    return [files.slice(0, mid), files.slice(mid)];
  }

  // Split directory groups into two halves by cumulative size
  const half = totalSize(files) / 2;
  const left: RepoFile[] = [];
  const right: RepoFile[] = [];
  let leftSize = 0;

  for (const dir of dirs) {
    const group = groups.get(dir)!;
    const groupSize = totalSize(group);
    if (leftSize + groupSize <= half || left.length === 0) {
      left.push(...group);
      leftSize += groupSize;
    } else {
      right.push(...group);
    }
  }

  // Safety: if one side is empty, force a split
  if (right.length === 0) {
    const mid = Math.ceil(left.length / 2);
    return [left.slice(0, mid), left.slice(mid)];
  }

  return [left, right];
}

function formatChunk(files: RepoFile[]): string {
  const sections: string[] = [];

  sections.push("## File Tree\n");
  sections.push("```");
  sections.push(buildTree(files.map((f) => f.path)));
  sections.push("```");
  sections.push("");

  sections.push("## File Contents\n");
  for (const f of files) {
    sections.push(`### ${f.path}\n`);
    sections.push("```");
    sections.push(f.content);
    sections.push("```");
    sections.push("");
  }

  return sections.join("\n");
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

/** Split a single large file into multiple chunks by lines. */
function splitLargeFile(file: RepoFile, label: string): ContextChunk[] {
  const lines = file.content.split("\n");
  const chunks: ContextChunk[] = [];
  let start = 0;
  let part = 1;

  while (start < lines.length) {
    let end = start;
    let size = 0;
    while (end < lines.length && size + lines[end].length + 1 <= MAX_CHUNK_SIZE) {
      size += lines[end].length + 1;
      end++;
    }
    if (end === start) end = start + 1; // at least one line

    const slice = lines.slice(start, end).join("\n");
    const partFile: RepoFile = {
      path: `${file.path} (lines ${start + 1}-${end})`,
      content: slice,
      size: slice.length,
    };
    chunks.push({
      label: `${label} part ${part}`,
      files: [partFile],
      totalSize: slice.length,
      formatted: formatChunk([partFile]),
    });
    start = end;
    part++;
  }

  return chunks;
}

/** Recursively split files into chunks that fit within MAX_CHUNK_SIZE. */
function splitIntoChunks(files: RepoFile[], label: string): ContextChunk[] {
  const size = totalSize(files);
  if (size <= MAX_CHUNK_SIZE) {
    return [{ label, files, totalSize: size, formatted: formatChunk(files) }];
  }

  // Single file that's too large — split by lines
  if (files.length === 1) {
    return splitLargeFile(files[0], label);
  }

  const [left, right] = splitByDir(files);
  return [
    ...splitIntoChunks(left, `${label} (part 1)`),
    ...splitIntoChunks(right, `${label} (part 2)`),
  ];
}

export function loadRepoChunks(localPath: string): ContextChunk[] {
  const allFiles: RepoFile[] = [];
  walkDir(localPath, localPath, allFiles);

  console.log(`  Loaded ${allFiles.length} files, ${Math.round(totalSize(allFiles) / 1024)}KB total`);

  return splitIntoChunks(allFiles, "repo");
}
