/** Private Codex launcher, invoked only by the host-created ACP process. Never a model tool. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { videoAppServerRequest } from './video-app-server-boundary.mjs';

const args = process.argv.slice(2);
if (!process.env.OPENFILM_VIDEO_REAL_CODEX || args[0] !== 'app-server' || args.length !== 1) {
  process.stderr.write('The video planner cannot run CLI commands.\n'); process.exit(1);
}
const child = spawn(process.env.OPENFILM_VIDEO_REAL_CODEX, ['app-server'], { cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const input = createInterface({ input: process.stdin });
const output = createInterface({ input: child.stdout });
const write = (stream, value) => stream.write(`${JSON.stringify(value)}\n`);
input.on('line', line => {
  try {
    if (line.length > 32 * 1024 * 1024) throw new Error('limit');
    const message = JSON.parse(line);
    try { write(child.stdin, videoAppServerRequest(message, process.cwd())); }
    catch { if (message.id != null) write(process.stdout, { id: message.id, error: { code: -32601, message: 'Unavailable in video-only mode' } }); }
  } catch { child.kill('SIGTERM'); process.exitCode = 1; }
});
output.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.id != null && message.method) {
      // Native file/command approval or dynamic tools never become an approval button in the product.
      write(child.stdin, { id: message.id, error: { code: -32601, message: 'Video planner has no execution tools' } });
      return;
    }
    process.stdout.write(`${line}\n`);
  } catch { child.kill('SIGTERM'); process.exitCode = 1; }
});
child.stderr.on('data', () => {}); // Credentials, private URLs and raw native diagnostics are not forwarded.
child.on('error', () => { process.stderr.write('Video planner process could not start.\n'); process.exit(1); });
child.on('exit', code => { input.close(); process.exit(code ?? 1); });
process.stdin.on('close', () => { child.stdin.end(); });
process.on('SIGTERM', () => { child.kill('SIGTERM'); });
process.on('SIGINT', () => { child.kill('SIGTERM'); });
