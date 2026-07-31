// 剧本事件 + 乘客生成 + 形状解锁 深层单测：
// 多事件同时刻触发、surge 在 simulation 中确实多刷乘客、稀有形状解锁时机、
// pumpEvents/tickActiveEvents 的状态机边界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState, defaultScenario } from '../src/game/state.ts';
import { step } from '../src/game/simulation.ts';
import {
  buildEventQueue,
  pumpEvents,
  tickActiveEvents,
} from '../src/game/events.ts';
import { isEventActive } from '../src/game/eventRegistry.ts';
import { ALL_SHAPES, type ActiveEvent, type Scenario, type ScriptedEvent } from '../src/game/types.ts';

function scenarioWith(events: ScriptedEvent[]): Scenario {
  const s = defaultScenario();
  s.events = events;
  return s;
}

// ---------- 多事件同时刻 / 触发顺序 ----------

test('pumpEvents 同时刻多事件全部触发（按队列原顺序）', () => {
  const s = scenarioWith([
    { at: 10, kind: 'strike', stationShape: 'circle', duration: 5 },
    { at: 10, kind: 'surge', stationShape: 'square', duration: 5 },
    { at: 10, kind: 'slow', duration: 5 },
  ]);
  const q = buildEventQueue(s);
  const active: ActiveEvent[] = [];
  pumpEvents(10, q, active);
  assert.equal(active.length, 3, '同时刻三个事件应全部转 active');
  assert.equal(q.length, 0);
});

test('pumpEvents 跨多个时间点分批触发，已触发的不再触发', () => {
  const s = scenarioWith([
    { at: 5, kind: 'slow', duration: 4 },
    { at: 15, kind: 'slow', duration: 4 },
    { at: 25, kind: 'slow', duration: 4 },
  ]);
  const q = buildEventQueue(s);
  const active: ActiveEvent[] = [];
  pumpEvents(10, q, active);
  assert.equal(active.length, 1, '10s 只触发 at=5');
  pumpEvents(20, q, active);
  assert.equal(active.length, 2, '20s 再触发 at=15');
  pumpEvents(30, q, active);
  assert.equal(active.length, 3, '30s 再触发 at=25');
  assert.equal(q.length, 0);
});

test('pumpEvents elapsed 远超所有事件时间：一次性全部触发', () => {
  const s = scenarioWith([
    { at: 1, kind: 'slow', duration: 2 },
    { at: 5, kind: 'slow', duration: 2 },
  ]);
  const q = buildEventQueue(s);
  const active: ActiveEvent[] = [];
  pumpEvents(100, q, active);
  assert.equal(active.length, 2);
  assert.equal(q.length, 0);
});

test('pumpEvents 空队列 / 未到点：不变', () => {
  const q = buildEventQueue(scenarioWith([{ at: 100, kind: 'slow', duration: 5 }]));
  const active: ActiveEvent[] = [];
  pumpEvents(50, q, active);
  assert.equal(active.length, 0);
  assert.equal(q.length, 1);
});

// ---------- tickActiveEvents 状态机 ----------

test('tickActiveEvents：多个事件剩余不同，各自衰减/移除', () => {
  const active: ActiveEvent[] = [
    { kind: 'slow', remaining: 10 },
    { kind: 'strike', stationShape: 'circle', remaining: 0.5 },
    { kind: 'surge', stationShape: 'square', remaining: 3 },
  ];
  tickActiveEvents(active, 1);
  assert.equal(active.length, 2, 'remaining=0.5 的事件应被移除');
  assert.equal(active[0]!.kind, 'slow');
  assert.equal(active[1]!.kind, 'surge');
  assert.ok(Math.abs(active[0]!.remaining - 9) < 1e-9);
  assert.ok(Math.abs(active[1]!.remaining - 2) < 1e-9);
});

test('tickActiveEvents：恰好归零（<=0）被移除', () => {
  const active: ActiveEvent[] = [{ kind: 'slow', remaining: 1 }];
  tickActiveEvents(active, 1);
  assert.equal(active.length, 0, 'remaining 恰好到 0 应移除');
});

test('tickActiveEvents：dt=0 不改变状态', () => {
  const active: ActiveEvent[] = [{ kind: 'slow', remaining: 5 }];
  tickActiveEvents(active, 0);
  assert.equal(active.length, 1);
  assert.equal(active[0]!.remaining, 5);
});

// ---------- surge 在 simulation 中确实多刷乘客 ----------

test('surge 事件生效时乘客生成翻倍', () => {
  function countPassengers(elapsed: number, withSurge: boolean): number {
    const s = createInitialState(42);
    s.phase = 'running';
    // 关掉站点/道具生成与过载判定干扰
    s.nextStationIn = 1e9;
    s.nextPowerUpIn = 1e9;
    if (withSurge) {
      s.activeEvents.push({ kind: 'surge', stationShape: 'circle', remaining: 1000 });
    }
    // 用大间隔避免基线刷太多；但我们要刷得够多看差异
    s.passengerInterval = 1;
    s.nextPassengerIn = 1;
    const rng = new Rng(42);
    for (let i = 0; i < elapsed; i++) step(s, 1, rng);
    return s.stations.reduce((n, st) => n + st.passengers.length, 0) + s.delivered;
  }
  const normal = countPassengers(20, false);
  const surge = countPassengers(20, true);
  // surge 应明显多于 normal（约 2 倍，留宽松下界确保不是噪声）
  assert.ok(surge > normal * 1.5, `surge(${surge}) 应远多于 normal(${normal})`);
});

test('surge 事件过期后不再多刷乘客', () => {
  const s = createInitialState(42);
  s.phase = 'running';
  s.nextStationIn = 1e9;
  s.nextPowerUpIn = 1e9;
  s.passengerInterval = 1;
  s.nextPassengerIn = 1;
  // surge 只持续 3 秒
  s.activeEvents.push({ kind: 'surge', stationShape: 'circle', remaining: 3 });
  const rng = new Rng(42);
  step(s, 3, rng);
  const duringCount = s.stations.reduce((n, st) => n + st.passengers.length, 0) + s.delivered;
  const activeAfter = s.activeEvents.length;
  assert.equal(activeAfter, 0, '3s 后 surge 应已过期移除');
  // surge 移除后 isEventActive 应为 false
  assert.equal(isEventActive(s.activeEvents, 'surge', 'circle'), false);
  // duringCount 应 > 0（期间刷过乘客）
  assert.ok(duringCount > 0);
});

// ---------- 稀有形状解锁时机 ----------

test('初始解锁形状数为 3', () => {
  const s = createInitialState(1);
  assert.equal(s.unlockedShapes, 3);
});

test('t=30s 解锁第 4 种形状', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  s.nextStationIn = 1e9;
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  const rng = new Rng(1);
  step(s, 29, rng);
  assert.equal(s.unlockedShapes, 3, '29s 仍为 3');
  step(s, 1, rng); // 累计 30s
  assert.equal(s.unlockedShapes, 4, '30s 解锁第 4 种');
});

test('t=60s 解锁第 5 种（ALL_SHAPES 上限）', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  s.nextStationIn = 1e9;
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  const rng = new Rng(1);
  step(s, 60, rng);
  assert.equal(s.unlockedShapes, 5);
  step(s, 60, rng); // 120s
  assert.equal(s.unlockedShapes, 5, '达到 ALL_SHAPES 上限不再增加');
  assert.equal(ALL_SHAPES.length, 5);
});

test('解锁形状数随时间单调递增（不回退）', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  s.nextStationIn = 1e9;
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  const rng = new Rng(1);
  let prev = s.unlockedShapes;
  for (let t = 0; t < 120; t += 5) {
    step(s, 5, rng);
    assert.ok(s.unlockedShapes >= prev, '解锁数不应回退');
    prev = s.unlockedShapes;
  }
});

// ---------- buildEventQueue 稳定性 ----------

test('buildEventQueue 不修改原 scenario.events', () => {
  const events: ScriptedEvent[] = [
    { at: 30, kind: 'slow', duration: 5 },
    { at: 10, kind: 'strike', stationShape: 'circle', duration: 5 },
  ];
  const s = scenarioWith(events);
  const before = s.events.map((e) => ({ ...e }));
  buildEventQueue(s);
  assert.deepEqual(
    s.events.map((e) => ({ ...e })),
    before,
    '原 events 数组顺序与内容应不变',
  );
});

test('buildEventQueue 已排序输入保持稳定', () => {
  const s = scenarioWith([
    { at: 10, kind: 'slow', duration: 5 },
    { at: 20, kind: 'slow', duration: 5 },
  ]);
  const q = buildEventQueue(s);
  assert.deepEqual(
    q.map((e) => e.at),
    [10, 20],
  );
});

// ---------- slow 事件与 simulation 集成（速度减半） ----------

test('slow 事件生效时列车速度 ×0.5（同样时间走的路程更短）', () => {
  function runTrain(withSlow: boolean): number {
    const s = createInitialState(1);
    s.phase = 'running';
    s.nextStationIn = 1e9;
    s.nextPowerUpIn = 1e9;
    s.nextPassengerIn = 1e9;
    // 建一条 0→1 线
    const [a, b] = s.stations;
    a!.pos = { x: 0, y: 0 };
    b!.pos = { x: 100, y: 0 };
    s.lines.push({ id: 0, color: 'red', stops: [a!.id, b!.id] });
    s.trains.push({
      lineId: 0,
      segment: 0,
      t: 0,
      direction: 1,
      passengers: [],
      dwellTimer: 0,
    });
    if (withSlow) s.activeEvents.push({ kind: 'slow', remaining: 1000 });
    const rng = new Rng(1);
    step(s, 1, rng);
    // 用列车 t 值反映走了多远（同段长度，t 越大走得越多）
    return s.trains[0]!.t;
  }
  const normal = runTrain(false);
  const slow = runTrain(true);
  assert.ok(slow < normal, `slow(${slow}) 应 < normal(${normal})`);
  // 减速是 ×0.5，宽松验证约为一半
  assert.ok(slow < normal * 0.7, '减速后路程应明显更短');
});
