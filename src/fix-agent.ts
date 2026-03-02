import { Agent } from "@opperai/agents";
import { z } from "zod";
import { createTools } from "./tools.ts";

const FixResultSchema = z.object({
  fixable: z.boolean().describe("Whether the issue could be fixed in code"),
  explanation: z.string().describe("What was done, or why it cannot be fixed automatically"),
});
export type FixResult = z.infer<typeof FixResultSchema>;

export function createFixAgent(owner: string, repo: string, localPath: string) {
  const model = process.env.MODEL;
  if (!model) throw new Error("MODEL environment variable is not set.");
  const { listRepoFiles, readFile, searchCode, searchAndReplace } = createTools(owner, repo, localPath);
  return new Agent<string, FixResult>({
    name: "FixAgent",
    instructions: `You are an automated code fixer. You are given a SOC2 compliance finding with a file path.
Your job is to apply a minimal, targeted fix to the code.

Guidelines:
- Read the relevant file(s) before making changes
- Use search_and_replace to make targeted changes — one call per change
- Only fix what is described in the finding. Do not refactor unrelated code.
- If the fix requires human action (e.g. rotating secrets, architectural changes, adding external service), set fixable=false and explain why.
- If the file no longer contains the issue, set fixable=false with explanation "already fixed".
- Prefer the minimal change: e.g. replace a hardcoded secret with process.env.VAR_NAME, add a missing header, etc.

Use owner="${owner}" and repo="${repo}" for all tool calls.`,
    tools: [listRepoFiles, readFile, searchCode, searchAndReplace],
    outputSchema: FixResultSchema,
    model,
    maxIterations: 20,
  });
}
