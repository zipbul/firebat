import * as path from 'node:path';

import * as z from 'zod';

interface OxlintDiagnostic {
  readonly filePath?: string;
  readonly message: string;
  readonly code?: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly line?: number;
  readonly column?: number;
}

interface OxlintRunResult {
  readonly ok: boolean;
  readonly tool: 'oxlint';
  readonly exitCode?: number;
  readonly error?: string;
  readonly rawStdout?: string;
  readonly rawStderr?: string;
  readonly diagnostics?: ReadonlyArray<OxlintDiagnostic>;
}

interface RunOxlintInput {
  readonly targets: ReadonlyArray<string>;
  readonly configPath?: string;
}

const splitCommand = (value: string): string[] => value.split(/\s+/).filter(Boolean);

const tryResolveOxlintCommand = async (): Promise<string[] | null> => {
  const candidates = [
    // project-local
    path.resolve(process.cwd(), 'node_modules', '.bin', 'oxlint'),

    // firebat package-local (dist/* sibling to node_modules/*)
    path.resolve(import.meta.dir, '../../../node_modules', '.bin', 'oxlint'),
    path.resolve(import.meta.dir, '../../node_modules', '.bin', 'oxlint'),
  ];

  for (const candidate of candidates) {
    try {
      const file = Bun.file(candidate);

      if (await file.exists()) {
        return [candidate];
      }
    } catch {
      // ignore
    }
  }

  if (typeof Bun.which === 'function') {
    const resolved = Bun.which('oxlint');

    if (resolved !== null && resolved.length > 0) {
      return [resolved];
    }
  }

  return null;
};

const SeveritySchema = z.enum(['error', 'warning', 'info']);
const OxlintDiagnosticSchema = z
  .object({
    filePath: z.string().optional(),
    path: z.string().optional(),
    file: z.string().optional(),
    filename: z.string().optional(),
    message: z.string().optional(),
    text: z.string().optional(),
    code: z.string().optional(),
    ruleId: z.string().optional(),
    rule: z.string().optional(),
    severity: SeveritySchema.optional(),
    level: SeveritySchema.optional(),
    line: z.number().optional(),
    row: z.number().optional(),
    startLine: z.number().optional(),
    column: z.number().optional(),
    col: z.number().optional(),
    startColumn: z.number().optional(),
  })
  .loose();
const OxlintOutputSchema = z.union([
  z.array(OxlintDiagnosticSchema),
  z.looseObject({ diagnostics: z.array(OxlintDiagnosticSchema) }),
]);

type OxlintOutput = z.infer<typeof OxlintOutputSchema>;

const normalizeDiagnosticsFromParsed = (value: OxlintOutput): ReadonlyArray<OxlintDiagnostic> => {
  const rawList = Array.isArray(value) ? value : value.diagnostics;
  const out: OxlintDiagnostic[] = [];

  for (const item of rawList) {
    const message = item.message ?? item.text ?? 'oxlint diagnostic';
    const code = item.code ?? item.ruleId ?? item.rule;
    const severityRaw = item.severity ?? item.level;
    const severity: OxlintDiagnostic['severity'] = severityRaw ?? 'warning';
    const filePath = item.filePath ?? item.path ?? item.file ?? item.filename;
    const line = item.line ?? item.row ?? item.startLine;
    const column = item.column ?? item.col ?? item.startColumn;
    const normalized: OxlintDiagnostic = {
      message,
      severity,
      ...(filePath !== undefined ? { filePath } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    };

    out.push(normalized);
  }

  return out;
};

const runOxlint = async (input: RunOxlintInput): Promise<OxlintRunResult> => {
  const cmd = await tryResolveOxlintCommand();

  if (!cmd || cmd.length === 0) {
    return {
      ok: false,
      tool: 'oxlint',
      error: 'oxlint is not available. Install it (or use a firebat build that bundles it) to enable the lint tool.',
    };
  }

  const args: string[] = [];

  if (input.configPath !== undefined && input.configPath.trim().length > 0) {
    args.push('--config', input.configPath);
  }

  // NOTE: oxlint JSON output flags may differ by version. For now, treat stdout/stderr as raw,
  // but if stdout is valid JSON, attempt best-effort normalization.
  args.push(...input.targets);

  const proc = Bun.spawn({
    cmd: [...cmd, ...args],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return { ok: false, tool: 'oxlint', exitCode, rawStdout: stdout, rawStderr: stderr, error: `oxlint exited with code ${exitCode}` };
  }

  const trimmed = stdout.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = OxlintOutputSchema.safeParse(JSON.parse(trimmed));

      if (parsed.success) {
        const diagnostics = normalizeDiagnosticsFromParsed(parsed.data);

        return { ok: true, tool: 'oxlint', exitCode, rawStdout: stdout, rawStderr: stderr, diagnostics };
      }
    } catch {
      // fallthrough
    }
  }

  return { ok: true, tool: 'oxlint', exitCode, rawStdout: stdout, rawStderr: stderr, diagnostics: [] };
};

export { runOxlint };
export type { OxlintDiagnostic, OxlintRunResult, RunOxlintInput };
