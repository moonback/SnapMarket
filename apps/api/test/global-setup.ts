import { execSync } from 'node:child_process';
import path from 'node:path';
import './setup-env';

export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env },
    stdio: 'pipe',
  });
}
