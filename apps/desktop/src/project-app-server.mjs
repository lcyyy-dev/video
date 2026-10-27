import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { projectRequest } from './project-boundary.mjs';

if (!process.env.OPENFILM_VIDEO_REAL_CODEX || process.argv.slice(2).join(' ') !== 'app-server') process.exit(1);
const child = spawn(process.env.OPENFILM_VIDEO_REAL_CODEX, ['app-server'], { cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  let message;
  try { message = JSON.parse(line); const forwarded = projectRequest(message, process.cwd()); child.stdin.write(JSON.stringify(forwarded) + '\n'); }
  catch (error) { if (message?.id != null) process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32602, message: error.message } }) + '\n'); }
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('exit', code => { input.close(); process.exit(code ?? 1); });
child.on('error', () => process.exit(1));
process.stdin.on('end', () => child.stdin.end());
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
