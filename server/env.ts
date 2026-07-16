// 零依赖 .env 加载器（搬自 agentresearch/src/env.ts，保持两个子项目一致）。
// 只做最小可用：解析 KEY=VALUE，不覆盖已存在的环境变量。

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex <= 0) return null;
  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/** 幂等地从 cwd（或指定目录）读取 .env 注入 process.env。 */
export function loadEnv(cwd: string = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  const envPath = resolve(cwd, '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** 读取环境变量，未设置时返回 fallback。 */
export function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}
