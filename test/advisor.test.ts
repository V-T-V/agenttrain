// 顾问与工具单测：serializeSnapshot / parseAdvice / mockAdvice + autopilot 工具映射。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockAdvice, parseAdvice, serializeSnapshot, shapeName } from '../src/ai/advisor.ts';
import { buildAutopilotTools } from '../src/ai/tools.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine } from '../src/game/simulation.ts';
import type { GameState } from '../src/game/types.ts';

function runningState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  // 给站点固定形状便于断言
  s.stations[0]!.shape = 'circle';
  s.stations[1]!.shape = 'triangle';
  s.stations[2]!.shape = 'square';
  s.stations[3]!.shape = 'star';
  return s;
}

test('serializeSnapshot 包含站点与线路信息', () => {
  const s = runningState();
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('站点:'));
  assert.ok(snap.includes('线路:'));
  assert.ok(snap.includes('时间'));
});

test('serializeSnapshot 带过载标记', () => {
  const s = runningState();
  s.stations[0]!.passengers = Array.from({ length: 6 }, () => ({ target: 'square' as const }));
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('过载'));
});

test('parseAdvice 合法 JSON 解析', () => {
  const s = runningState();
  const text = JSON.stringify({
    comment: '○站拥堵，建议连到□。',
    action: 'create',
    fromShape: 'circle',
    toShape: 'square',
  });
  const a = parseAdvice(text, s);
  assert.equal(a.action, 'create');
  assert.equal(a.fromShape, 'circle');
  assert.equal(a.toShape, 'square');
});

test('parseAdvice 非法 action 降级为 observe', () => {
  const s = runningState();
  const a = parseAdvice(JSON.stringify({ comment: '嗯', action: 'fly' }), s);
  assert.equal(a.action, 'observe');
});

test('parseAdvice 非法形状被丢弃', () => {
  const s = runningState();
  const a = parseAdvice(
    JSON.stringify({ comment: '建议', action: 'create', fromShape: 'hexagon' }),
    s,
  );
  assert.equal(a.fromShape, undefined);
});

test('parseAdvice 非 JSON 回退 mockAdvice', () => {
  const s = runningState();
  const a = parseAdvice('不是 json', s);
  assert.ok(a.comment.length > 0);
  assert.ok(['create', 'extend', 'remove', 'observe'].includes(a.action));
});

test('mockAdvice 找最堵站给出建议', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }, { target: 'square' }];
  const a = mockAdvice(s);
  assert.ok(a.action === 'create' || a.action === 'extend');
  assert.equal(a.fromShape, 'circle');
  assert.equal(a.toShape, 'square');
});

test('mockAdvice 无乘客时返回 observe', () => {
  const s = runningState();
  const a = mockAdvice(s);
  assert.equal(a.action, 'observe');
});

test('shapeName 五种形状都有输出', () => {
  assert.equal(shapeName('circle'), '○');
  assert.equal(shapeName('triangle'), '△');
  assert.equal(shapeName('square'), '□');
  assert.equal(shapeName('diamond'), '◇');
  assert.equal(shapeName('star'), '☆');
});

// ---------- autopilot 工具 ----------

test('buildAutopilotTools 提供 3 个工具', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  assert.equal(tools.length, 3);
  assert.deepEqual(
    tools.map((t) => t.name),
    ['create_line', 'extend_line', 'remove_line'],
  );
});

test('create_line 工具成功建线', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  const res = create.execute({ fromShape: 'circle', toShape: 'triangle' });
  assert.equal((res as { ok: boolean }).ok, true);
  assert.equal(s.lines.length, 1);
});

test('create_line 相同形状建线失败', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  // 只有一个 circle 站，from 和 to 解析成同一站 → createLine 拒绝
  const res = create.execute({ fromShape: 'circle', toShape: 'circle' });
  assert.equal((res as { ok: boolean }).ok, false);
});

test('extend_line 工具：建线后可延伸', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id); // circle-triangle
  const tools = buildAutopilotTools(s);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  // 把以 triangle 为端点的线延伸到 square
  const res = extend.execute({ fromShape: 'triangle', toShape: 'square' });
  assert.equal((res as { ok: boolean }).ok, true);
  assert.equal(s.lines[0]!.stops.length, 3);
});

test('remove_line 工具按颜色删除', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const color = s.lines[0]!.color;
  const tools = buildAutopilotTools(s);
  const remove = tools.find((t) => t.name === 'remove_line')!;
  const res = remove.execute({ color });
  assert.equal((res as { ok: boolean }).ok, true);
  assert.equal(s.lines.length, 0);
});
