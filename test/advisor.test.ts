// 顾问与工具单测：serializeSnapshot / parseAdvice / mockAdvice + autopilot 工具映射。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineStrategyAdvice,
  mockAdvice,
  parseAdvice,
  serializeSnapshot,
  shapeName,
} from '../src/ai/advisor.ts';
import { buildAutopilotTools } from '../src/ai/tools.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine } from '../src/game/simulation.ts';
import type { GameState, LineColor, Shape, Station } from '../src/game/types.ts';

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

// ---------- lineStrategyAdvice（多线路策略评估集成） ----------

/** 构造干净 running 态、关闭干扰机制、清空初始站点。 */
function bareStrategyState(capacity = 6): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.capacity = capacity;
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  s.nextStationIn = 1e9;
  s.stations = [];
  s.lines = [];
  s.trains = [];
  return s;
}

function st(id: number, shape: Shape, x: number, y: number, passengers = 0): Station {
  return {
    id,
    shape,
    pos: { x, y },
    passengers: Array.from({ length: passengers }, () => ({ target: 'square' as const })),
    overloadTimer: 0,
    kind: 'normal',
  };
}

/** 串一条线路并配一列载客列车。 */
function line(
  state: GameState,
  color: LineColor,
  stops: Station[],
  onboard: number,
): void {
  for (const s of stops) {
    if (!state.stations.some((x) => x.id === s.id)) state.stations.push(s);
  }
  const id = state.nextLineId++;
  state.lines.push({ id, color, stops: stops.map((s) => s.id) });
  state.trains.push({
    lineId: id,
    segment: 0,
    t: 0,
    direction: 1,
    passengers: Array.from({ length: onboard }, () => ({ target: 'square' as const })),
    dwellTimer: 0,
  });
}

test('lineStrategyAdvice: 无线路 → observe', () => {
  const s = bareStrategyState();
  const a = lineStrategyAdvice(s);
  assert.equal(a.action, 'observe');
});

test('lineStrategyAdvice: 仅一条线 → observe（单线无策略意义）', () => {
  const s = bareStrategyState();
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 100, 0)], 3);
  const a = lineStrategyAdvice(s);
  assert.equal(a.action, 'observe');
});

test('lineStrategyAdvice: 最差线评分 <35 → 建议 remove 重构', () => {
  const s = bareStrategyState();
  // 高分线
  line(
    s,
    'red',
    [st(1, 'circle', 0, 0), st(2, 'triangle', 1500, 0), st(3, 'square', 3000, 0)],
    6,
  );
  // 极低分线（空载、单形状、远端、不可延伸 → overall 必然 < 35）
  line(s, 'blue', [st(4, 'diamond', 9000, 0), st(5, 'diamond', 9100, 0)], 0);
  const a = lineStrategyAdvice(s);
  assert.equal(a.action, 'remove');
  assert.ok(a.comment.includes('blue'), `应点名 blue 线：${a.comment}`);
  assert.ok(a.comment.includes('重构'));
});

test('lineStrategyAdvice: 最差线拥堵且可延伸 → 建议 extend 分流', () => {
  const s = bareStrategyState();
  // 线路 A：优质线
  line(
    s,
    'red',
    [st(1, 'circle', 0, 0), st(2, 'triangle', 1500, 0), st(3, 'square', 3000, 0)],
    6,
  );
  // 线路 B：评分中等（>=35）但沿线有拥堵站，且端点可延伸
  // 用 2 站、适当载客使其 overall 落在 35-60 区间，并给端点附近放可延伸站
  line(s, 'blue', [st(4, 'star', 5000, 0, 5), st(5, 'diamond', 5100, 0, 0)], 2);
  // blue 线 head(star@5000) 附近放一个未连接站 → 触发可延伸
  s.stations.push(st(6, 'square', 5050, 0));
  const a = lineStrategyAdvice(s);
  assert.equal(a.action, 'extend');
  assert.ok(a.comment.includes('blue'));
});

test('lineStrategyAdvice: 最差线评分适中且无拥堵 → observe 附策略点评', () => {
  const s = bareStrategyState();
  // 两条对称、评分相近、均无拥堵的线
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 100, 0)], 3);
  line(s, 'blue', [st(3, 'square', 200, 0), st(4, 'star', 300, 0)], 3);
  const a = lineStrategyAdvice(s);
  assert.equal(a.action, 'observe');
  assert.ok(a.comment.length > 0);
});

test('serializeSnapshot 含策略评估行（均分/拥堵/利用率）', () => {
  const s = bareStrategyState();
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 100, 0)], 3);
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('策略:'), `应含策略行：${snap}`);
  assert.ok(snap.includes('均分'));
});
