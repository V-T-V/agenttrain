// simulation 单测：建线、装卸客、过载结束、延伸/删除线路。
// 全部基于纯函数，不依赖 DOM/Canvas。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import {
  createLine,
  extendLine,
  linePoints,
  removeLine,
  step,
  trainPosition,
} from '../src/game/simulation.ts';
import { STATION_CAPACITY } from '../src/game/config.ts';
import type { GameState } from '../src/game/types.ts';

/** 构造一个确定种子的初始运行态状态。 */
function runningState(seed = 1): GameState {
  const s = createInitialState(seed);
  s.phase = 'running';
  return s;
}

test('初始状态有 4 个站点、无线路', () => {
  const s = createInitialState(1);
  assert.equal(s.stations.length, 4);
  assert.equal(s.lines.length, 0);
  assert.equal(s.trains.length, 0);
  assert.equal(s.phase, 'ready');
});

test('createLine 在两站间成功建线并生成一列车', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  const ok = createLine(s, a.id, b.id);
  assert.equal(ok, true);
  assert.equal(s.lines.length, 1);
  assert.equal(s.trains.length, 1);
  assert.equal(s.trains[0]!.lineId, s.lines[0]!.id);
});

test('createLine 相同站点失败', () => {
  const s = runningState();
  const a = s.stations[0]!;
  assert.equal(createLine(s, a.id, a.id), false);
  assert.equal(s.lines.length, 0);
});

test('createLine 达到 7 条上限后失败', () => {
  const s = runningState();
  // 站点不够就再加几个
  while (s.stations.length < 16) {
    s.stations.push({
      id: s.nextStationId++,
      shape: 'circle',
      pos: { x: 100 + s.stations.length * 30, y: 100 },
      passengers: [],
      overloadTimer: 0,
    });
  }
  let made = 0;
  for (let i = 0; i < s.stations.length - 1 && made < 10; i++) {
    if (createLine(s, s.stations[i]!.id, s.stations[i + 1]!.id)) made++;
  }
  assert.equal(made, 7); // 上限
  assert.equal(s.lines.length, 7);
});

test('列车到目标形状站点送达并加分', () => {
  const s = runningState();
  // 强制构造：站 A 是 circle，站 B 是 triangle，建 A-B 线
  const a = s.stations[0]!;
  const b = s.stations[1]!;
  a.shape = 'circle';
  b.shape = 'triangle';
  a.passengers = [{ target: 'triangle' }, { target: 'triangle' }];
  createLine(s, a.id, b.id);

  const before = s.delivered;
  // 让列车跑很久，确保它到 B 站
  const rng = new Rng(2);
  step(s, 60, rng);

  assert.ok(s.delivered > before, '应有乘客被送达');
});

test('站点持续超载触发 gameover', () => {
  const s = runningState();
  const st = s.stations[0]!;
  // 塞满乘客
  st.passengers = Array.from({ length: STATION_CAPACITY }, () => ({ target: 'square' }));
  // 没有任何线路 → 乘客不会被运走 → 持续超载
  const rng = new Rng(5);
  // OVERLOAD_GRACE = 6 秒，多跑一些确保触发
  for (let i = 0; i < 1000 && s.phase === 'running'; i++) {
    step(s, 0.1, rng);
  }
  assert.equal(s.phase, 'gameover');
});

test('未满载的站点不会触发 gameover', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }]; // 只有 1 个
  const rng = new Rng(5);
  step(s, 30, rng);
  assert.equal(s.phase, 'running');
});

test('extendLine 在尾部追加站点', () => {
  const s = runningState();
  const [a, b, c] = s.stations;
  assert.ok(a && b && c);
  createLine(s, a.id, b.id);
  const line = s.lines[0]!;
  const ok = extendLine(s, line.id, c.id, false);
  assert.equal(ok, true);
  assert.deepEqual(line.stops, [a.id, b.id, c.id]);
});

test('extendLine 头部追加会平移列车 segment', () => {
  const s = runningState();
  const [a, b, c] = s.stations;
  assert.ok(a && b && c);
  createLine(s, a.id, b.id);
  const line = s.lines[0]!;
  const train = s.trains[0]!;
  train.segment = 0;
  extendLine(s, line.id, c.id, true);
  assert.deepEqual(line.stops, [c.id, a.id, b.id]);
  assert.equal(train.segment, 1, '头部插入一段后 segment 应 +1');
});

test('extendLine 拒绝重复站点', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  createLine(s, a.id, b.id);
  const line = s.lines[0]!;
  assert.equal(extendLine(s, line.id, a.id, false), false);
});

test('removeLine 同时移除该线列车', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  createLine(s, a.id, b.id);
  const id = s.lines[0]!.id;
  removeLine(s, id);
  assert.equal(s.lines.length, 0);
  assert.equal(s.trains.length, 0);
});

test('linePoints / trainPosition 返回合理坐标', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  createLine(s, a.id, b.id);
  const line = s.lines[0]!;
  const pts = linePoints(s, line);
  assert.equal(pts.length, 2);
  const pos = trainPosition(s, s.trains[0]!);
  assert.ok(typeof pos.x === 'number' && typeof pos.y === 'number');
});

test('step 在非 running 阶段不推进时间', () => {
  const s = createInitialState(1); // ready
  const rng = new Rng(1);
  const before = s.elapsed;
  step(s, 5, rng);
  assert.equal(s.elapsed, before);
});

test('乘客生成会随时间出现', () => {
  const s = runningState();
  const rng = new Rng(8);
  const before = s.stations.reduce((n, st) => n + st.passengers.length, 0);
  step(s, 12, rng);
  const after = s.stations.reduce((n, st) => n + st.passengers.length, 0);
  assert.ok(after > before || s.delivered > 0, '应当有新乘客出现（或已被送达）');
});
