import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { execCommand } from "../utils/exec.js";

export interface RepoContext {
  repoPath: string;
  inGitRepo: boolean;
  gitStatus: string;
  files: string[];
}

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".collab"]);

export async function collectRepoContext(repoPath: string): Promise<RepoContext> {
  const [inGitRepo, gitStatus, files] = await Promise.all([
    detectGitRepo(repoPath),
    getGitStatus(repoPath),
    discoverFiles(repoPath, 80)
  ]);

  return {
    repoPath,
    inGitRepo,
    gitStatus,
    files
  };
}

async function detectGitRepo(repoPath: string): Promise<boolean> {
  try {
    await execCommand(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      7000,
      process.env,
      repoPath
    );
    return true;
  } catch {
    return false;
  }
}

async function getGitStatus(repoPath: string): Promise<string> {
  try {
    const result = await execCommand(
      "git",
      ["status", "--short"],
      10000,
      process.env,
      repoPath
    );

    return result.stdout.trim() || "clean";
  } catch {
    return "not-a-git-repo";
  }
}

async function discoverFiles(repoPath: string, maxFiles: number): Promise<string[]> {
  const discovered: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (discovered.length >= maxFiles) {
      return;
    }

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (discovered.length >= maxFiles) {
        return;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }

        await walk(join(dir, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      discovered.push(relative(repoPath, join(dir, entry.name)));
    }
  }

  await walk(repoPath);

  return discovered;
}

export function formatRepoContext(context: RepoContext): string {
  return [
    `repoPath: ${context.repoPath}`,
    `inGitRepo: ${context.inGitRepo}`,
    "gitStatus:",
    context.gitStatus,
    "files:",
    context.files.slice(0, 40).join("\n") || "(none)"
  ].join("\n");
}
