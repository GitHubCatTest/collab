import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function execCommand(
  file: string,
  args: string[],
  timeoutMs = 15000,
  env?: NodeJS.ProcessEnv,
  cwd?: string
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
        env,
        cwd
      },
      (error, stdout, stderr) => {
        if (error) {
          const withStreams = Object.assign(error, {
            stdout,
            stderr
          }) as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          reject(withStreams);
          return;
        }

        resolve({ stdout, stderr, code: 0 });
      }
    );
  });
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await execCommand("which", [command], 5000);
    return true;
  } catch {
    return false;
  }
}
