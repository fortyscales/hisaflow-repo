const { spawn, spawnSync } = require('child_process');
const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://hisaflow:hisaflow_dev@127.0.0.1:54329/hisaflow',
  JWT_SECRET: process.env.JWT_SECRET || 'integration-only-change-me-please',
  PORT: process.env.PORT || '4100',
  NODE_ENV: 'test',
};

function runNode(script, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: serverRoot,
    stdio: 'inherit',
    env,
    windowsHide: true,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`COMMAND_FAILED:${script}:${r.status}`);
}

async function waitForServer() {
  const url = `http://127.0.0.1:${env.PORT}/api/v1/health/ready`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`SERVER_NOT_READY:${url}`);
}

function stopServer(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch {}
}

(async () => {
  // Use the current Node executable directly instead of npm.cmd. This avoids
  // Windows child_process spawn EINVAL while remaining portable on macOS/Linux.
  runNode(path.join('scripts', 'migrate.cjs'));

  const nestCli = require.resolve('@nestjs/cli/bin/nest.js', { paths: [serverRoot] });
  const server = spawn(process.execPath, [nestCli, 'start'], {
    cwd: serverRoot,
    stdio: 'inherit',
    env,
    windowsHide: true,
  });
  if (server.error) throw server.error;

  let childFailure;
  server.once('error', error => { childFailure = error; });
  server.once('exit', code => {
    if (code && code !== 0) childFailure = new Error(`SERVER_EXITED:${code}`);
  });

  try {
    await waitForServer();
    if (childFailure) throw childFailure;
    runNode(path.join('test', 'e2e', 'two-device-postgres.e2e.cjs'));
  } finally {
    stopServer(server);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
