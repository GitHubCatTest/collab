import { execFile } from "node:child_process";

export interface GitApplyResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface ApplyPatchSafelyArgs {
  repoPath: string;
  patchPath: string;
  checkOnly?: boolean;
}

export interface ApplyPatchSafelyResult {
  ok: boolean;
  checked: boolean;
  applied: boolean;
  message: string;
  stdout: string;
  stderr: string;
}

export async function checkPatchApplies(
  repoPath: string,
  patchPath: string
): Promise<GitApplyResult> {
  return runGitApply(repoPath, ["apply", "--check", patchPath]);
}

export async function applyPatch(
  repoPath: string,
  patchPath: string
): Promise<GitApplyResult> {
  return runGitApply(repoPath, ["apply", patchPath]);
}

export async function applyPatchSafely(
  args: ApplyPatchSafelyArgs
): Promise<ApplyPatchSafelyResult> {
  const check = await checkPatchApplies(args.repoPath, args.patchPath);
  if (!check.success) {
    return {
      ok: false,
      checked: true,
      applied: false,
      message: "Patch failed dry-run applicability check",
      stdout: check.stdout,
      stderr: check.stderr
    };
  }

  if (args.checkOnly) {
    return {
      ok: true,
      checked: true,
      applied: false,
      message: "Patch dry-run check passed",
      stdout: check.stdout,
      stderr: check.stderr
    };
  }

  const apply = await applyPatch(args.repoPath, args.patchPath);
  if (!apply.success) {
    return {
      ok: false,
      checked: true,
      applied: false,
      message: "Patch apply failed after passing dry-run check",
      stdout: apply.stdout,
      stderr: apply.stderr
    };
  }

  return {
    ok: true,
    checked: true,
    applied: true,
    message: "Patch applied successfully",
    stdout: apply.stdout,
    stderr: apply.stderr
  };
}

async function runGitApply(
  cwd: string,
  args: string[]
): Promise<GitApplyResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8"
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            success: true,
            code: 0,
            stdout,
            stderr
          });
          return;
        }

        const typed = error as NodeJS.ErrnoException & { code?: number | string };
        resolve({
          success: false,
          code: typeof typed.code === "number" ? typed.code : 1,
          stdout,
          stderr: stderr || typed.message
        });
      }
    );
  });
}
