// Starts the BidLock room server (server/) on this machine for the tests, with
// `wrangler dev`: the same Worker and Durable Object code that runs on Cloudflare, in
// Cloudflare's local runtime. No account or network needed.
//
//   const rooms = await startRoomServer({ vars: { GUEST_GRACE_MS: 2000 } });
//   rooms.http, rooms.ws ... await rooms.stop();
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export async function startRoomServer({ vars = {}, timeoutMs = 90000 } = {}) {
  const port = await freePort();
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'bidlock-rooms-'));
  const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const args = [wrangler, 'dev', '--config', path.join(ROOT, 'server', 'wrangler.jsonc'), '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', String(await freePort()), '--persist-to', persist, '--log-level', 'warn', '--show-interactive-dev-session=false'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const http = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode == null) {
      // wrangler runs the runtime as a child process: end the whole tree.
      if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } } else child.kill('SIGTERM');
      await new Promise((r) => { if (child.exitCode != null) r(); else { child.once('exit', r); setTimeout(r, 5000); } });
    }
    // The runtime can hold its files for a moment after it stops (Windows).
    try { fs.rmSync(persist, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* left for the OS to clean */ }
  };
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode != null) throw new Error(`wrangler dev stopped:\n${log}`);
    try {
      const r = await fetch(`${http}/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > until) { await stop(); throw new Error(`wrangler dev did not start in time:\n${log}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { http, ws: http.replace(/^http/, 'ws'), port, log: () => log, stop };
}
