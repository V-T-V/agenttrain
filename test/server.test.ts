// server/ 代理层纯函数测试：env.ts（.env 加载器）、retry.ts（指数退避）。
// 之前 server/ 零测试（与 dashan 有 server.test.ts 不一致），补上这块真实盲区。
// 注：server/index.ts 顶层 server.listen() 会阻塞进程退出，无法在 node --test 里
// 做集成测试；这里只覆盖 env/retry 两个纯模块（路由逻辑由 dashan 的同类 server 覆盖）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------- env.ts ----------

import { env, loadEnv } from '../server/env.ts';

test('env(): 未设置时返回 fallback', () => {
  assert.equal(env('AGENTTRAIN_NONEXISTENT_KEY_X', 'default'), 'default');
});

test('env(): 已设置的环境变量优先', () => {
  process.env['AGENTTRAIN_TEST_PRESENT'] = 'from-process';
  assert.equal(env('AGENTTRAIN_TEST_PRESENT', 'fallback'), 'from-process');
});

test('env(): fallback 默认空串', () => {
  assert.equal(env('AGENTTRAIN_ANOTHER_MISSING_X'), '');
});

test('loadEnv: 不覆盖已存在的环境变量', () => {
  process.env['AGENTTRAIN_EXISTING'] = 'keep-me';
  const dir = join(tmpdir(), `agenttrain-env-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.env'), 'AGENTTRAIN_EXISTING=from-file\n');
  loadEnv(dir); // 幂等，不抛错
  assert.equal(process.env['AGENTTRAIN_EXISTING'], 'keep-me');
  rmSync(dir, { recursive: true, force: true });
});

test('loadEnv: 文件不存在时不抛错', () => {
  assert.doesNotThrow(() => loadEnv(join(tmpdir(), `nonexistent-${Date.now()}`)));
});

// ---------- retry.ts ----------

import { isRetryableStatus, withRetry } from '../server/retry.ts';

test('isRetryableStatus: 429 与 5xx 可重试，4xx 不可', () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
});

test('withRetry: 首次成功直接返回', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry: 失败后重试成功', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw new Error('fail');
      return 'recovered';
    },
    { retries: 3, baseDelayMs: 1, maxDelayMs: 5 },
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
});

test('withRetry: 重试耗尽后抛最后错误', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error('always-fail');
        },
        { retries: 2, baseDelayMs: 1, maxDelayMs: 5 },
      ),
    /always-fail/,
  );
  assert.equal(calls, 3); // 1 + 2 retries
});

test('withRetry: retryOn 返回 false 立即抛错', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error('skip');
        },
        { retries: 3, baseDelayMs: 1, retryOn: () => false },
      ),
    /skip/,
  );
  assert.equal(calls, 1, 'retryOn=false 时不应重试');
});

test('withRetry: 把 attempt 序号传给 fn', async () => {
  const seen: number[] = [];
  await withRetry(
    async (attempt) => {
      seen.push(attempt);
      if (attempt < 1) throw new Error('again');
      return 'done';
    },
    { retries: 3, baseDelayMs: 1 },
  );
  assert.deepEqual(seen, [0, 1]);
});
