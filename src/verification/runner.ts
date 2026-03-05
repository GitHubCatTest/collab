import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type {
  VerificationCommandResult,
  VerificationProfile,
  VerificationResult
} from "../types/index.js";

interface VerificationArgs {
  repoPath: string;
  profile: VerificationProfile;
  commandsOverride?: string[];
  timeoutMs?: number;
}

export async function runVerification(
  args: VerificationArgs
): Promise<VerificationResult> {
  const commands = await resolveVerificationCommands(
    args.repoPath,
    args.profile,
    args.commandsOverride
  );

  if (args.profile === "none" || commands.length === 0) {
    return {
      profile: args.profile,
      passed: true,
      commandResults: [],
      summary:
        args.profile === "none"
          ? "Verification disabled (profile=none)."
          : "No verification commands available for repository."
    };
  }

  const commandResults: VerificationCommandResult[] = [];
  let passed = true;

  for (const command of commands) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runShellCommand(
      command,
      args.repoPath,
      args.timeoutMs ?? 240000
    );
    commandResults.push(result);

    if (!result.success) {
      passed = false;
      break;
    }
  }

  const summary = passed
    ? `Verification passed (${commandResults.length}/${commands.length} commands).`
    : `Verification failed at command: ${
        commandResults.find((result) => !result.success)?.command ?? "unknown"
      }`;

  return {
    profile: args.profile,
    passed,
    commandResults,
    summary
  };
}

async function resolveVerificationCommands(
  repoPath: string,
  profile: VerificationProfile,
  override?: string[]
): Promise<string[]> {
  if (Array.isArray(override) && override.length > 0) {
    return override;
  }

  if (profile === "none") {
    return [];
  }

  const packageJson = await readPackageJson(repoPath);
  if (!packageJson?.scripts || typeof packageJson.scripts !== "object") {
    return [];
  }

  const scripts = packageJson.scripts as Record<string, unknown>;
  const commands: string[] = [];

  if (typeof scripts.lint === "string") {
    commands.push("npm run lint");
  }

  if (typeof scripts.test === "string") {
    commands.push("npm test");
  }

  if (profile === "strict" && typeof scripts.build === "string") {
    commands.push("npm run build");
  }

  return commands;
}

async function readPackageJson(repoPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(repoPath, "package.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    if (typed.code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read package.json: ${typed.message}`);
  }
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<VerificationCommandResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-lc", command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 12 * 1024 * 1024,
        encoding: "utf8"
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        if (!error) {
          resolve({
            command,
            success: true,
            code: 0,
            stdout,
            stderr,
            durationMs
          });
          return;
        }

        const typed = error as NodeJS.ErrnoException & { code?: string | number };
        const code = typeof typed.code === "number" ? typed.code : 1;

        resolve({
          command,
          success: false,
          code,
          stdout,
          stderr: stderr || typed.message,
          durationMs
        });
      }
    );
  });
}
