import { exec } from 'child_process';
import { ClaudeBridgePlugin } from '../types/plugin.js';

function runShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

export const builtinsPlugin: ClaudeBridgePlugin = {
  name: 'builtins',
  description: 'Built-in actions for common development tasks',
  actions: {
    formatDocument:   () => runShell('npx prettier --write .'),
    saveAll:          () => Promise.resolve('Use Ctrl+K S in VS Code to save all'),
    gitStatus:        () => runShell('git status'),
    gitCommit:        (args) => runShell(`git add -A && git commit -m "${String(args.message ?? 'Claude commit')}"`),
    npmInstall:       () => runShell('npm install'),
    npmTest:          () => runShell('npm test'),
    npmBuild:         () => runShell('npm run build'),
    listFiles:        (args) => runShell(`ls -la "${String(args.dir ?? '.')}"`),
    showNotification: (args) => {
      const text = String(args.text ?? 'Hello from Claude!');
      console.log(`\n📢 NOTIFICATION: ${text}\n`);
      return Promise.resolve(text);
    },
  },
};
