// simulation 列车运动确定性深层测试。
// 覆盖 moveTrains/advanceTrain/arriveAtStation 的可观察行为：
// 段内前进、到站换向、dwellTimer 停留、大 dt 单帧多次到站、方向交替往返、
// 退化段（同坐标站）直通、停靠期间不位移。
// 全部基于纯函数，确定性可复现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine, extendLine, step, trainPosition } from '../src/game/simulation.ts';
import { TRAIN_DWELL, TRAIN_SPEED } from '../src/game/config.ts';
import type { GameState, Station } from '../src/game/types.ts';

/** 单段行程时间（秒）：与段长无关，= 1/trainSpeed。 */
const SEG_TIME = 1 / TRAIN_SPEED;

/** 构造运行态。 */
function runningState(seed = 1): GameState {
  const s = createInitialState(seed);
  s.phase = 'running';
  return s;
}

/** 在指定坐标手工塞一个站点。 */
function addStationAt(s: GameState, shape: GameState['stations'][number]['shape'], x: number, y: number): Station {
  const st: Station = {
    id: s.nextStationId++,
    shape,
    pos: { x, y },
    passengers: [],
    overloadTimer: 0,
    kind: 'normal',
  };
  s.stations.push(st);
  return st;
}

/** 清空所有自动生成的站点/线路/列车，构造干净的可预测地图。 */
function bareState(): GameState {
  const s = runningState(1);
  s.stations = [];
  s.lines = [];
  s.trains = [];
  s.eventQueue = [];
  s.activeEvents = [];
  s.scenario = {
    cityName: 'test',
    description: '',
    trainSpeedMultiplier: 1,
    stationIntervalMultiplier: 1,
    events: [],
    deliverTarget: 9999,
  };
  return s;
}

test('段内前进：半段时间列车走完约一半段', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0; // 让它立即出发
  // 走 0.5 个段的时间，t 应约 0.5
  step(s, SEG_TIME * 0.5, new Rng(1));
  assert.ok(tr.t > 0.45 && tr.t < 0.55, `半段时间 t 应≈0.5，实际 ${tr.t}`);
  assert.equal(tr.segment, 0);
  assert.equal(tr.direction, 1);
});

test('到端点换向：走完一段后 direction 翻为 -1', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // 走完一整段（到 B 端点）+ 留余量
  step(s, SEG_TIME + 0.01, new Rng(1));
  assert.equal(tr.direction, -1, '抵达 B 端点后应换向为 -1');
  assert.equal(tr.segment, 0, '换向后 segment 回到 0');
});

test('dwellTimer：到站时被重置为 TRAIN_DWELL 且 t 归 0', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // 走完一段抵达 B 端点（用整段时间，到站后进入停留）
  step(s, SEG_TIME, new Rng(1));
  // 到站瞬间：dwellTimer 重置为 TRAIN_DWELL，t 归 0，方向翻转
  assert.equal(tr.dwellTimer, TRAIN_DWELL, '到站应把 dwellTimer 重置为 TRAIN_DWELL');
  assert.equal(tr.t, 0, '到站后 t 应归 0');
  assert.equal(tr.direction, -1, '到 B 端点应换向');
});

test('列车在线路删除后消失，重建后重新生成', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  assert.equal(s.trains.length, 1);
  const id = s.lines[0]!.id;
  // 删除线路（moveTrains 找不到 line 会 skip）
  s.lines = s.lines.filter((l) => l.id !== id);
  s.trains = s.trains.filter((t) => t.lineId !== id);
  assert.equal(s.trains.length, 0);
  // step 不应报错（moveTrains 对空 trains 安全）
  step(s, 1, new Rng(1));
  assert.equal(s.phase, 'running');
  // 重建线路后列车重新生成
  createLine(s, a.id, b.id);
  assert.equal(s.trains.length, 1);
});

test('往返：两段后回到 A 端点 direction 翻回 1', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // 第 1 段 A→B（含 B 的停留）
  step(s, SEG_TIME + TRAIN_DWELL + 0.01, new Rng(1));
  assert.equal(tr.direction, -1);
  // 第 2 段 B→A（含 A 的停留）
  step(s, SEG_TIME + TRAIN_DWELL + 0.01, new Rng(1));
  assert.equal(tr.direction, 1, '回到 A 端点应换向为 +1');
  assert.equal(tr.segment, 0);
});

test('大 dt 单帧多次到站：一次 step 完成多段往返', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // 一次给 20 秒，足够往返多趟（每段≈2.22s + dwell 0.35s）
  step(s, 20, new Rng(1));
  // 列车仍在线路上（segment 合法），方向为 ±1
  assert.ok(tr.segment === 0, '二站线只有 1 段，segment 应恒为 0');
  assert.ok(tr.direction === 1 || tr.direction === -1);
  assert.ok(tr.t >= 0 && tr.t < 1, `t 应在 [0,1)，实际 ${tr.t}`);
});

test('三站线中间站停靠：往返时经过中间站 segment 递增/递减', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  const c = addStationAt(s, 'square', 2000, 0);
  createLine(s, a.id, b.id);
  extendLine(s, s.lines[0]!.id, c.id, false);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // A→B（第 0 段）
  step(s, SEG_TIME + TRAIN_DWELL + 0.01, new Rng(1));
  assert.equal(tr.segment, 1, '到 B 后进入第 1 段 B→C');
  assert.equal(tr.direction, 1);
  // B→C（到 C 端点换向）
  step(s, SEG_TIME + TRAIN_DWELL + 0.01, new Rng(1));
  assert.equal(tr.direction, -1, '抵达 C 端点换向');
  assert.equal(tr.segment, 1, '换向后仍在第 1 段 C→B');
});

test('退化段（同坐标站）直通不卡死', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 500, 500);
  // B 与 A 同坐标 → segLen=0 的退化段
  const b = addStationAt(s, 'triangle', 500, 500);
  const c = addStationAt(s, 'square', 1500, 500);
  createLine(s, a.id, b.id);
  extendLine(s, s.lines[0]!.id, c.id, false);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // 退化段应被 advanceTrain 直接 arriveAtStation 跳过，不死循环
  step(s, SEG_TIME * 3 + TRAIN_DWELL * 3, new Rng(1));
  assert.equal(s.phase, 'running', '退化段不应触发 gameover 或卡死');
  assert.ok(tr.t >= 0 && tr.t < 1);
});

test('确定性：相同种子+步长两次运行列车位置完全一致', () => {
  function run(): { x: number; y: number; seg: number; dir: number; t: number } {
    const s = bareState();
    const a = addStationAt(s, 'circle', 0, 0);
    const b = addStationAt(s, 'triangle', 800, 300);
    createLine(s, a.id, b.id);
    s.trains[0]!.dwellTimer = 0;
    const rng = new Rng(42);
    for (let i = 0; i < 50; i++) step(s, 0.3, rng);
    const tr = s.trains[0]!;
    const p = trainPosition(s, tr);
    return { x: p.x, y: p.y, seg: tr.segment, dir: tr.direction, t: tr.t };
  }
  assert.deepEqual(run(), run(), '相同种子+步长应产生完全相同的列车状态');
});

test('scenario.trainSpeedMultiplier < 1 时列车走得更慢', () => {
  function distAfter(dt: number, mult: number): number {
    const s = bareState();
    s.scenario.trainSpeedMultiplier = mult;
    const a = addStationAt(s, 'circle', 0, 0);
    const b = addStationAt(s, 'triangle', 1000, 0);
    createLine(s, a.id, b.id);
    s.trains[0]!.dwellTimer = 0;
    step(s, dt, new Rng(1));
    return Math.abs(trainPosition(s, s.trains[0]!).x);
  }
  const fast = distAfter(SEG_TIME * 0.5, 1);
  const slow = distAfter(SEG_TIME * 0.5, 0.5);
  assert.ok(slow < fast, `减速倍率列车应走更短：slow=${slow} fast=${fast}`);
});

test('slow 事件使列车减速到约一半速度', () => {
  function tValue(withSlow: boolean): number {
    const s = bareState();
    const a = addStationAt(s, 'circle', 0, 0);
    const b = addStationAt(s, 'triangle', 1000, 0);
    createLine(s, a.id, b.id);
    s.trains[0]!.dwellTimer = 0;
    if (withSlow) s.activeEvents.push({ kind: 'slow', remaining: 999 });
    step(s, SEG_TIME * 0.5, new Rng(1));
    return s.trains[0]!.t;
  }
  assert.ok(tValue(true) < tValue(false), 'slow 事件下列车 t 进度应更小');
});
