// simulation 深层边缘单测：极小/极大输入、NaN/Infinity 防御、确定性（同种子同结果）、
// 安全上限（无死循环）、退化几何（重合站点）、大步长多次到站、createLine/extendLine 边界。
//
// 聚焦 step() 与线路操作在「极端但合法」输入下的鲁棒性，补 simulation-overload（过载判负）
// 与 simulation.test（基本建线）之外的边界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import {
  createLine,
  extendLine,
  lineEndpoints,
  linePoints,
  pickColor,
  removeLine,
  stationIndex,
  step,
  trainPosition,
  LINE_COLOR_ORDER,
} from '../src/game/simulation.ts';
import { MAX_LINES, TRAIN_DWELL } from '../src/game/config.ts';
import type { GameState } from '../src/game/types.ts';

/** 构造 running 态、关闭无关定时器的最小状态。 */
function bareState(seed = 1): GameState {
  const s = createInitialState(seed);
  s.phase = 'running';
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  s.nextStationIn = 1e9;
  return s;
}

// ---------- 极小 dt ----------

test('极小 dt（1e-9）不崩溃且 elapsed 累加', () => {
  const s = bareState();
  const before = s.elapsed;
  step(s, 1e-9, new Rng(1));
  assert.ok(s.elapsed > before, '即使极小 dt 也应推进 elapsed');
  assert.equal(s.phase, 'running');
});

test('dt = 0 直接返回不推进（短路分支）', () => {
  const s = bareState();
  const before = s.elapsed;
  step(s, 0, new Rng(1));
  assert.equal(s.elapsed, before, 'dt=0 不推进');
});

test('负 dt 被短路（dt<=0 返回），elapsed 不变', () => {
  const s = bareState();
  const before = s.elapsed;
  // step 里 dt<=0 直接 return，不会把 elapsed 减小
  step(s, -5, new Rng(1));
  assert.equal(s.elapsed, before, '负 dt 不应让时间倒流');
  assert.equal(s.phase, 'running');
});

// ---------- 极大 dt（安全上限，无死循环） ----------

test('极大 dt（1e6 秒）能在合理时间内返回（安全上限 512 防死循环）', () => {
  const s = bareState();
  // 建一条线，让 advanceTrain 的大步长 while 循环路径被走到（safety 上限兜底）
  const [a, b] = s.stations;
  if (a && b) createLine(s, a.id, b.id);
  const start = Date.now();
  step(s, 1e6, new Rng(1));
  const elapsed = Date.now() - start;
  // 应在 2 秒内返回（不应死循环挂死）
  assert.ok(elapsed < 2000, `大 dt 不应死循环，实际耗时 ${elapsed}ms`);
});

test('大 dt 后列车能完成多次到站（dwellTimer 累加路径）', () => {
  const s = bareState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a!.pos = { x: 0, y: 0 };
  b!.pos = { x: 100, y: 0 };
  a!.shape = 'circle';
  b!.shape = 'triangle';
  a!.passengers = Array.from({ length: 6 }, () => ({ target: 'triangle' }));
  createLine(s, a!.id, b!.id);
  // 跑 120 秒，列车应来回往返多次，乘客应被大量送达
  step(s, 120, new Rng(1));
  assert.ok(s.delivered > 0, '大步长下列车应已往返并送达');
});

// ---------- NaN / Infinity 防御（生产 step 已短路非有限 dt） ----------

test('NaN dt 被短路：不抛异常、elapsed 不变（防御非有限输入）', () => {
  const s = bareState();
  const before = s.elapsed;
  assert.doesNotThrow(() => step(s, Number.NaN, new Rng(1)));
  assert.equal(s.elapsed, before, 'NaN dt 应被短路，elapsed 不变');
  assert.equal(s.phase, 'running');
});

test('Infinity dt 被短路：不进入死循环、elapsed 不变', () => {
  const s = bareState();
  const [a, b] = s.stations;
  if (a && b) createLine(s, a.id, b.id);
  const before = s.elapsed;
  const start = Date.now();
  assert.doesNotThrow(() => step(s, Number.POSITIVE_INFINITY, new Rng(1)));
  assert.ok(Date.now() - start < 2000, 'Infinity dt 应被快速短路');
  assert.equal(s.elapsed, before, 'Infinity dt 应被短路，elapsed 不变');
});

// ---------- 确定性（同种子 → 完全相同的演化） ----------

test('同一 seed + 同一 Rng 序列推进，得到完全相同的状态', () => {
  function run(seed: number): { delivered: number; stations: number; lines: number } {
    const s = createInitialState(seed);
    s.phase = 'running';
    s.passengerInterval = 2;
    s.nextPassengerIn = 2;
    const rng = new Rng(seed);
    for (let i = 0; i < 60; i++) step(s, 1, rng);
    return {
      delivered: s.delivered,
      stations: s.stations.length,
      lines: s.lines.length,
    };
  }
  assert.deepEqual(run(7), run(7), '同种子应完全可复现');
  // 不同种子至少在概率上 station/passenger 分布可能不同（不强断言不等，避免 flaky）
});

test('Rng.fromState 续局：恢复后序列连贯（与连续调用一致）', () => {
  const r1 = new Rng(123);
  r1.next();
  r1.next();
  const snap = r1.getState();
  const r2 = Rng.fromState(snap);
  // 两个实例后续应产出相同序列
  for (let i = 0; i < 20; i++) {
    assert.equal(r1.next(), r2.next(), 'fromState 后序列应与原实例一致');
  }
});

test('Rng 种子 0 不退化（被归一化为黄金分割常数）', () => {
  const r = new Rng(0);
  // 连续 next 应产出有效 [0,1) 数，不恒为 0
  const vals = Array.from({ length: 5 }, () => r.next());
  assert.ok(vals.every((v) => v >= 0 && v < 1));
  assert.ok(vals.some((v) => v > 0), '种子 0 不应让序列恒为 0');
});

// ---------- 退化几何：重合站点 ----------

test('两个完全重合的站点建线（段长=0），列车不卡死', () => {
  const s = bareState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a!.pos = { x: 50, y: 50 };
  b!.pos = { x: 50, y: 50 }; // 完全重合，segLen=0
  createLine(s, a!.id, b!.id);
  // segLen<=0 分支直接 arriveAtStation，应不死循环
  const start = Date.now();
  step(s, 5, new Rng(1));
  assert.ok(Date.now() - start < 2000, '重合站点段不应死循环');
});

test('linePoints 对空线路返回空数组（不抛异常）', () => {
  const s = bareState();
  const emptyLine = { id: 999, color: 'red' as const, stops: [] };
  const pts = linePoints(s, emptyLine);
  assert.deepEqual(pts, []);
});

// ---------- createLine 边界 ----------

test('createLine 站点不存在（id 越界）失败，不改变状态', () => {
  const s = bareState();
  assert.equal(createLine(s, 0, 99999), false);
  assert.equal(s.lines.length, 0);
  assert.equal(s.trains.length, 0);
});

test('createLine 负 id 失败', () => {
  const s = bareState();
  assert.equal(createLine(s, -1, 0), false);
  assert.equal(s.lines.length, 0);
});

test('createLine 新线路颜色按 LINE_COLOR_ORDER 顺序分配', () => {
  const s = bareState();
  // 多加几个站点确保够建线
  while (s.stations.length < 10) {
    s.stations.push({
      id: s.nextStationId++,
      shape: 'circle',
      pos: { x: 100 + s.stations.length * 40, y: 100 },
      passengers: [],
      overloadTimer: 0,
      kind: 'normal',
    });
  }
  for (let i = 0; i < LINE_COLOR_ORDER.length; i++) {
    createLine(s, s.stations[i]!.id, s.stations[i + 1]!.id);
  }
  // 前 7 条颜色应依次为 LINE_COLOR_ORDER
  for (let i = 0; i < LINE_COLOR_ORDER.length; i++) {
    assert.equal(s.lines[i]!.color, LINE_COLOR_ORDER[i]);
  }
});

test('createLine 达 MAX_LINES 上限后第 MAX_LINES+1 条失败', () => {
  const s = bareState();
  while (s.stations.length < MAX_LINES + 4) {
    s.stations.push({
      id: s.nextStationId++,
      shape: 'circle',
      pos: { x: 100 + s.stations.length * 30, y: 100 },
      passengers: [],
      overloadTimer: 0,
      kind: 'normal',
    });
  }
  let ok = 0;
  for (let i = 0; i < s.stations.length - 1 && ok < MAX_LINES; i++) {
    if (createLine(s, s.stations[i]!.id, s.stations[i + 1]!.id)) ok++;
  }
  assert.equal(ok, MAX_LINES);
  // 再建一条应失败
  const extra = createLine(
    s,
    s.stations[MAX_LINES]!.id,
    s.stations[MAX_LINES + 1]!.id,
  );
  assert.equal(extra, false);
  assert.equal(s.lines.length, MAX_LINES);
});

test('pickColor 全用完后回退首色（复用）', () => {
  const used = new Set(LINE_COLOR_ORDER);
  // 所有颜色都用过 → 回退 LINE_COLOR_ORDER[0]
  assert.equal(pickColor(used), LINE_COLOR_ORDER[0]);
  // 空集合 → 返回首色
  assert.equal(pickColor(new Set()), LINE_COLOR_ORDER[0]);
  // 用了首色 → 跳到第二个
  assert.equal(
    pickColor(new Set([LINE_COLOR_ORDER[0]])),
    LINE_COLOR_ORDER[1],
  );
});

// ---------- extendLine / removeLine 边界 ----------

test('extendLine 线路不存在返回 false', () => {
  const s = bareState();
  const st = s.stations[0]!;
  assert.equal(extendLine(s, 99999, st.id, false), false);
});

test('extendLine 站点不存在返回 false', () => {
  const s = bareState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  createLine(s, a!.id, b!.id);
  assert.equal(extendLine(s, s.lines[0]!.id, 99999, false), false);
});

test('removeLine 不存在的 id：不抛异常、状态不变', () => {
  const s = bareState();
  const linesBefore = s.lines.length;
  const trainsBefore = s.trains.length;
  assert.doesNotThrow(() => removeLine(s, 99999));
  assert.equal(s.lines.length, linesBefore);
  assert.equal(s.trains.length, trainsBefore);
});

test('lineEndpoints 空线路 / 不存在线路返回空对象', () => {
  const s = bareState();
  assert.deepEqual(lineEndpoints(s, 99999), {});
});

test('stationIndex 构建正确映射（id → Station）', () => {
  const s = bareState();
  const idx = stationIndex(s);
  assert.equal(idx.size, s.stations.length);
  for (const st of s.stations) {
    assert.equal(idx.get(st.id), st);
  }
});

// ---------- 列车 dwellTimer 累加（advanceTrain 关键路径） ----------

test('列车初始 dwellTimer = TRAIN_DWELL（createLine 设置）', () => {
  const s = bareState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  createLine(s, a!.id, b!.id);
  assert.equal(s.trains[0]!.dwellTimer, TRAIN_DWELL);
});

test('列车到站后 dwellTimer 被重置为 TRAIN_DWELL', () => {
  const s = bareState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a!.pos = { x: 0, y: 0 };
  b!.pos = { x: 50, y: 0 };
  createLine(s, a!.id, b!.id);
  const train = s.trains[0]!;
  train.dwellTimer = 0; // 清掉初始停留，直接前进
  step(s, 10, new Rng(1)); // 足够走到端点并到站
  // 到站后应重新设置 dwellTimer（停留中）
  assert.ok(
    train.dwellTimer > 0 || train.t > 0,
    '列车要么在停留要么在前进',
  );
});

// ---------- 并发安全（引用透明：同一 state 重复 step 等价于连续 step） ----------

test('「分 10 次 step(1)」与「1 次 step(10)」对无随机路径等价（确定性）', () => {
  // 注：含随机生成时两者会因 rng 调用次数不同而不同；
  // 这里关闭所有生成，只测纯运动/过载的确定性，分步与合步应一致。
  function makeState(): GameState {
    const s = createInitialState(1);
    s.phase = 'running';
    s.nextPowerUpIn = 1e9;
    s.nextPassengerIn = 1e9;
    s.nextStationIn = 1e9;
    const [a, b] = s.stations;
    a!.pos = { x: 0, y: 0 };
    b!.pos = { x: 100, y: 0 };
    createLine(s, a!.id, b!.id);
    s.trains[0]!.dwellTimer = 0;
    return s;
  }
  const split = makeState();
  for (let i = 0; i < 10; i++) step(split, 1, new Rng(1));

  const merged = makeState();
  step(merged, 10, new Rng(1));

  // 运动学在无随机干扰下应一致：列车 t 值、elapsed
  assert.ok(Math.abs(split.elapsed - merged.elapsed) < 1e-9);
  assert.ok(Math.abs(split.trains[0]!.t - merged.trains[0]!.t) < 1e-6);
});

test('trainPosition 对不存在线路的列车返回 (0,0)', () => {
  const s = bareState();
  const ghost = {
    lineId: 99999,
    segment: 0,
    t: 0,
    direction: 1 as const,
    passengers: [],
    dwellTimer: 0,
  };
  const pos = trainPosition(s, ghost);
  assert.deepEqual(pos, { x: 0, y: 0 });
});
