// pnpm tunnel: a free HTTPS tunnel to the web dev server (Pinggy over SSH, no account or install), so a phone
// on any network can open the controller and iOS shares tilt. Writes the URL to .tunnel-url, which the server
// puts in the QR code. Free tunnels last 60 minutes; run it again for a new URL.
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

const FILE = new URL('../.tunnel-url', import.meta.url);
const port = process.env.WEB_PORT ?? '5173';
const ssh = spawn('ssh', ['-p', '443', '-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', `-R0:localhost:${port}`, 'a.pinggy.io'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let found = false;
const onData = (buf: Buffer) => {
  const text = buf.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  // Prefer *.pinggy.net: the *.pinggy-free.link names didn't resolve on the venue Wi-Fi.
  const urls = text.match(/https:\/\/[a-z0-9.-]+\.pinggy(?:-free)?\.(?:net|link|online)/g) ?? [];
  const url = urls.find((u) => u.endsWith('.pinggy.net')) ?? urls[0];
  if (url && !found) {
    found = true;
    writeFileSync(FILE, url);
    console.log(`\nPhone tunnel: ${url}\nThe QR code now points here. Run the web server with plain \`pnpm dev\` (the tunnel adds HTTPS). Ctrl+C to stop.\n`);
  }
};
ssh.stdout.on('data', onData);
ssh.stderr.on('data', onData);
const stop = () => {
  rmSync(FILE, { force: true });
  ssh.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
ssh.on('exit', (code) => {
  rmSync(FILE, { force: true });
  console.log(`tunnel closed (ssh exit ${code})`);
  process.exit(code ?? 0);
});
