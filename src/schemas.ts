import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.object({
  category: z.string().describe("SOC2 trust service criteria category"),
  severity: SeveritySchema.describe("Severity level"),
  title: z.string().describe("Short title of the finding"),
  description: z.string().describe("Detailed description"),
  file_path: z.string().nullable().describe("File path where issue was found, or null"),
  recommendation: z.string().describe("Recommended action"),
  soc2_reference: z.string().describe("Specific SOC2 section reference (e.g., 'CC6.1 - Logical and Physical Access Controls')"),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AgentFindingsSchema = z.object({
  criteria: z.string().describe("Trust service criteria name (e.g., 'Security')"),
  control_reference: z.string().describe("SOC2 control reference (e.g., 'CC6/CC7')"),
  summary: z.string().describe("Brief summary of the audit"),
  findings: z.array(FindingSchema).describe("List of findings"),
});
export type AgentFindings = z.infer<typeof AgentFindingsSchema>;
