// simulation 公共辅助函数深层测试 + 成就触发精确边界补充。
// 覆盖 stationIndex / linePoints 双分支 / pickColor 颜色循环 / lineEndpoints 边界 /
// trainPosition 退化 / LINE_COLOR_ORDER 顺序，以及 checkAchievements 的精确边界
// （speedrun ≤180s 严格边界、四难度互不串扰、幂等多次调用）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import {
  LINE_COLOR_ORDER,
  extendLine,
  createLine,
  lineEndpoints,
  linePoints,
  pickColor,
  removeLine,
  stationIndex,
  trainPosition,
} from '../src/game/simulation.ts';
import type { GameState, LineColor, Station } from '../src/game/types.ts';
import {
  ACHIEVEMENTS,
  checkAchievements,
  loadAchievements,
  type GameOverStats,
} from '../src/game/achievements.ts';

// localStorage 桩
const store = new Map<string, string>();
// @ts-expect-error 注入 localStorage 桩
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

function bareState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.stations = [];
  s.lines = [];
  s.trains = [];
  s.scenario = {
    cityName: 't',
    description: '',
    trainSpeedMultiplier: 1,
    stationIntervalMultiplier: 1,
    events: [],
    deliverTarget: 9999,
  };
  return s;
}

function addStationAt(s: GameState, x: number, y: number): Station {
  const st: Station = {
    id: s.nextStationId++,
    shape: 'circle',
    pos: { x, y },
    passengers: [],
    overloadTimer: 0,
    kind: 'normal',
  };
  s.stations.push(st);
  return st;
}

function stats(o: Partial<GameOverStats>): GameOverStats {
  return {
    delivered: 0,
    maxCombo: 0,
    difficulty: 'normal',
    elapsedSec: 0,
    powerUpsUsed: 0,
    reachedTarget: false,
    linesBuilt: 0,
    ...o,
  };
}

// ---------- stationIndex ----------

test('stationIndex 返回 id→Station 的完整映射', () => {
  const s = bareState();
  const a = addStationAt(s, 0, 0);
  const b = addStationAt(s, 100, 0);
  const c = addStationAt(s, 200, 0);
  const idx = stationIndex(s);
  assert.equal(idx.size, 3);
  assert.equal(idx.get(a.id), a);
  assert.equal(idx.get(b.id), b);
  assert.equal(idx.get(c.id), c);
});

test('stationIndex 对空站点列表返回空 Map', () => {
  const s = bareState();
  assert.equal(stationIndex(s).size, 0);
});

// ---------- linePoints 双分支 ----------

test('linePoints 在 ≤4 站点时走 find 分支，坐标正确', () => {
  const s = bareState();
  const a = addStationAt(s, 10, 20);
  const b = addStationAt(s, 30, 40);
  createLine(s, a.id, b.id);
  const pts = linePoints(s, s.lines[0]!);
  assert.deepEqual(pts, [
    { x: 10, y: 20 },
    { x: 30, y: 40 },
  ]);
});

test('linePoints 在 >4 站点时走 Map 索引分支，坐标与 find 分支一致', () => {
  const s = bareState();
  const sts: Station[] = [];
  for (let i = 0; i < 8; i++) sts.push(addStationAt(s, i * 10, i * 5));
  createLine(s, sts[0]!.id, sts[1]!.id);
  const line = s.lines[0]!;
  for (let i = 2; i < sts.length; i++) extendLine(s, line.id, sts[i]!.id, false);
  const pts = linePoints(s, line);
  assert.equal(pts.length, 8);
  // 每个点对应正确站点坐标
  for (let i = 0; i < 8; i++) {
    assert.equal(pts[i]!.x, i * 10);
    assert.equal(pts[i]!.y, i * 5);
  }
});

test('linePoints 跳过不存在的 stop（缺站）', () => {
  const s = bareState();
  const a = addStationAt(s, 0, 0);
  const b = addStationAt(s, 100, 0);
  createLine(s, a.id, b.id);
  // 手动塞一个不存在的 stop id 到中间
  s.lines[0]!.stops.splice(1, 0, 999999);
  const pts = linePoints(s, s.lines[0]!);
  assert.equal(pts.length, 2, '不存在的站点应被跳过，只剩 2 个点');
});

// ---------- pickColor / LINE_COLOR_ORDER ----------

test('LINE_COLOR_ORDER 顺序为 red blue green orange purple pink teal', () => {
  assert.deepEqual([...LINE_COLOR_ORDER], [
    'red',
    'blue',
    'green',
    'orange',
    'purple',
    'pink',
    'teal',
  ]);
});

test('pickColor：空 used 集返回首色 red', () => {
  assert.equal(pickColor(new Set<LineColor>()), 'red');
});

test('pickColor：用尽前 6 色后返回第 7 色 teal', () => {
  const used = new Set<LineColor>(['red', 'blue', 'green', 'orange', 'purple', 'pink']);
  assert.equal(pickColor(used), 'teal');
});

test('pickColor：7 色全用尽后回退首色 red（复用）', () => {
  const used = new Set<LineColor>([
    'red',
    'blue',
    'green',
    'orange',
    'purple',
    'pink',
    'teal',
  ]);
  assert.equal(pickColor(used), 'red', '超过 7 色应复用首色');
});

test('createLine 自动分配颜色按 LINE_COLOR_ORDER 顺序', () => {
  const s = bareState();
  for (let i = 0; i < 8; i++) addStationAt(s, i * 200, 0);
  for (let i = 0; i < 7; i++) {
    createLine(s, s.stations[i]!.id, s.stations[i + 1]!.id);
    assert.equal(s.lines[i]!.color, LINE_COLOR_ORDER[i]);
  }
  // 第 8 条线（idx 7）颜色复用 red
  createLine(s, s.stations[6]!.id, s.stations[7]!.id);
  assert.equal(s.lines[7]!.color, 'red');
});

// ---------- lineEndpoints ----------

test('lineEndpoints：不存在的 lineId 返回空对象', () => {
  const s = bareState();
  assert.deepEqual(lineEndpoints(s, 9999), {});
});

test('lineEndpoints：返回 head/tail 站点 id', () => {
  const s = bareState();
  const a = addStationAt(s, 0, 0);
  const b = addStationAt(s, 100, 0);
  const c = addStationAt(s, 200, 0);
  createLine(s, a.id, b.id);
  extendLine(s, s.lines[0]!.id, c.id, false);
  const ep = lineEndpoints(s, s.lines[0]!.id);
  assert.equal(ep.head, a.id);
  assert.equal(ep.tail, c.id);
});

test('lineEndpoints：空 stops 线路返回空对象', () => {
  const s = bareState();
  // 手工塞一条 stops 为空的线路
  s.lines.push({ id: 5, color: 'red', stops: [] });
  assert.deepEqual(lineEndpoints(s, 5), {});
});

// ---------- trainPosition ----------

test('trainPosition：无对应线路返回原点', () => {
  const s = bareState();
  const pos = trainPosition(s, { lineId: 9999, segment: 0, t: 0, direction: 1, passengers: [], dwellTimer: 0 });
  assert.deepEqual(pos, { x: 0, y: 0 });
});

test('trainPosition：线路只有 1 个点时（退化）返回该点', () => {
  const s = bareState();
  const a = addStationAt(s, 50, 60);
  const b = addStationAt(s, 100, 120);
  createLine(s, a.id, b.id);
  // 强制构造单点线路
  s.lines[0]!.stops = [a.id];
  const pos = trainPosition(s, s.trains[0]!);
  assert.deepEqual(pos, { x: 50, y: 60 });
});

// ---------- removeLine ----------

test('removeLine：删除不存在的 lineId 不报错', () => {
  const s = bareState();
  removeLine(s, 9999); // 应静默
  assert.equal(s.lines.length, 0);
});

// ---------- 成就精确边界补充 ----------

test('speedrun：恰好 180 秒送达 50 仍解锁（≤ 严格边界）', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 50, elapsedSec: 180 }));
  assert.ok(newly.includes('speedrun'), '180s 应触发 speedrun（条件 elapsedSec<=180）');
});

test('speedrun：181 秒送达 50 不解锁', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 50, elapsedSec: 181 }));
  assert.ok(!newly.includes('speedrun'));
});

test('speedrun：180 秒但只送达 49 不解锁', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 49, elapsedSec: 180 }));
  assert.ok(!newly.includes('speedrun'), '需送达≥50');
});

test('hard-clear 与 expert-clear 不串扰：hard 达标不触发 expert', () => {
  store.clear();
  const newly = checkAchievements(stats({ difficulty: 'hard', reachedTarget: true }));
  assert.ok(newly.includes('hard-clear'));
  assert.ok(!newly.includes('expert-clear'));
  assert.ok(!newly.includes('expert-200'));
});

test('checkAchievements 幂等：连续调用同一 stats 第二次返回空', () => {
  store.clear();
  const st = stats({ delivered: 100, maxCombo: 50, linesBuilt: 10 });
  const first = checkAchievements(st);
  assert.ok(first.length > 0);
  const second = checkAchievements(st);
  assert.equal(second.length, 0, '已解锁的成就二次调用不应重复返回');
});

test('成就总数与 ACHIEVEMENTS 数组长度一致', () => {
  assert.ok(ACHIEVEMENTS.length >= 20);
  // 确认 loadAchievements 在空 store 时返回空
  store.clear();
  assert.equal(loadAchievements().length, 0);
});

test('checkAchievements 写入 localStorage 的去重存档数量正确', () => {
  store.clear();
  checkAchievements(stats({ delivered: 100, maxCombo: 10, elapsedSec: 300 }));
  const stored = loadAchievements();
  // deliver-10/50/100, combo-10, survivor-5min 至少 5 个，无重复
  assert.ok(stored.length >= 5);
  assert.equal(new Set(stored).size, stored.length, '存档无重复');
});
