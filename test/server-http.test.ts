// D8: server/index.ts 的 readBody / sendJson 纯函数测试
// 此前 server/index.ts 完全未测（顶层 server.listen 阻塞进程，已在 D8 改为条件 listen）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { readBody, sendJson } from '../server/index.ts';

// ---- readBody ----

test('readBody: 正常读取请求体字符串', async () => {
  const req = Readable.from([Buffer.from('hello'), Buffer.from(' world')]);
  const body = await readBody(req as never);
  assert.equal(body, 'hello world');
});

test('readBody: 空请求体返回空串', async () => {
  const req = Readable.from([]);
  const body = await readBody(req as never);
  assert.equal(body, '');
});

test('readBody: 超过 1MB 拒绝并销毁流', async () => {
  // 构造一个大 Buffer（>1MB）分块推送
  const big = Buffer.alloc(1_100_000, 0x61); // 1.1MB 'a'
  const stream = new EventEmitter() as never;
  (stream as { destroy?: () => void }).destroy = () => {};
  let destroyed = false;
  (stream as { destroy: () => void }).destroy = () => { destroyed = true; };

  // 模拟 data/end 事件
  const promise = readBody(stream as never);
  // 推送大块
  stream.emit('data', big);
  await assert.rejects(promise, /请求体过大/);
  assert.ok(destroyed, '应调用 destroy()');
});

test('readBody: stream error 事件 reject', async () => {
  const stream = new EventEmitter() as never;
  const promise = readBody(stream as never);
  stream.emit('error', new Error('连接断开'));
  await assert.rejects(promise, /连接断开/);
});

test('readBody: 多块拼接正确', async () => {
  const chunks = ['{', '"name"', ':', '"test",', '"n":', '42', '}'].map((s) => Buffer.from(s));
  const req = Readable.from(chunks);
  const body = await readBody(req as never);
  assert.deepEqual(JSON.parse(body), { name: 'test', n: 42 });
});

// ---- sendJson ----

test('sendJson: 写入正确状态码和 JSON 体', () => {
  let capturedStatus = 0;
  let capturedHeaders: Record<string, string> = {};
  let capturedBody = '';

  const mockRes = {
    writeHead(status: number, headers: Record<string, string>) {
      capturedStatus = status;
      capturedHeaders = headers;
    },
    end(body: string) {
      capturedBody = body;
    },
  };

  sendJson(mockRes as never, 200, { ok: true, model: 'test' });
  assert.equal(capturedStatus, 200);
  assert.deepEqual(JSON.parse(capturedBody), { ok: true, model: 'test' });
});

test('sendJson: 设置 CORS 和 Content-Type 头', () => {
  let capturedHeaders: Record<string, string> = {};
  const mockRes = {
    writeHead(_s: number, headers: Record<string, string>) { capturedHeaders = headers; },
    end() {},
  };
  sendJson(mockRes as never, 200, {});
  assert.equal(capturedHeaders['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(capturedHeaders['Access-Control-Allow-Origin'], '*');
  assert.ok(capturedHeaders['Access-Control-Allow-Methods']?.includes('POST'));
});

test('sendJson: 错误状态码 400/404/500/503', () => {
  for (const status of [400, 404, 500, 503]) {
    let capturedStatus = 0;
    const mockRes = {
      writeHead(s: number) { capturedStatus = s; },
      end() {},
    };
    sendJson(mockRes as never, status, { error: 'test' });
    assert.equal(capturedStatus, status);
  }
});

test('sendJson: null/undefined 体序列化为合法 JSON', () => {
  let capturedBody = '';
  const mockRes = {
    writeHead() {},
    end(body: string) { capturedBody = body; },
  };
  sendJson(mockRes as never, 200, null);
  assert.equal(capturedBody, 'null');
});
