import { exec } from 'child_process';

export function runShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}
