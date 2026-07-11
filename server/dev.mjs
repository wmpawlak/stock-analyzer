import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBinary = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [
  spawn(process.execPath, [path.join(root, 'server', 'index.js')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [viteBinary], { cwd: root, stdio: 'inherit' }),
];

let closing = false;
const stop = (exitCode = 0) => {
  if (closing) return;
  closing = true;
  children.forEach((child) => {
    if (!child.killed) child.kill('SIGTERM');
  });
  process.exitCode = exitCode;
};

children.forEach((child) => {
  child.on('exit', (code) => {
    if (!closing) stop(code || 1);
  });
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('exit', () => {
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });
});
