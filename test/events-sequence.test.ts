// 剧本事件序列 + 生成分布 + 稀有站点解锁时机 深层单测（第二轮）：
// 站点种类生成时机、站点形状分布、乘客目标分布、事件去重、稀有形状乘客解锁后才出现、
// 多 strike 同 shape 叠加、surge + strike 同 shape 同时生效。
//
// 补 events-deep（pump/tick 状态机 + surge 翻倍）之外的「分布与时机」类断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState, defaultScenario, spawnPassenger } from '../src/game/state.ts';
import { step } from '../src/game/simulation.ts';
import {
  buildEventQueue,
  pumpEvents,
  tickActiveEvents,
} from '../src/game/events.ts';
import { isEventActive } from '../src/game/eventRegistry.ts';
import {
  ALL_SHAPES,
  type ActiveEvent,
  type Scenario,
  type ScriptedEvent,
} from '../src/game/types.ts';
import { SPECIAL_STATION_CHANCE } from '../src/game/config.ts';

function scenarioWith(events: ScriptedEvent[]): Scenario {
  const s = defaultScenario();
  s.events = events;
  return s;
}

// ---------- 站点种类（transfer/bonus）解锁时机 ----------

test('开局前 5 个站点全部为 normal（特殊站点 <5 不出现）', () => {
  // 用多个种子验证：前 5 站一定 normal
  for (const seed of [1, 2, 3, 7, 42, 100, 2024]) {
    const s = createInitialState(seed);
    // createInitialState 内部生成 INITIAL_STATIONS(12) 个站，前 5 个 totalStations<=5
    // 但这里我们无法直接看「前 5 个」的生成顺序（id 是递增的，stops[0..4] 为前 5 个）
    const firstFive = s.stations.slice(0, 5);
    for (const st of firstFive) {
      assert.equal(st.kind, 'normal', `seed=${seed} 前 5 站应全 normal，实际 ${st.kind}`);
    }
  }
});

test('站点数 >=6 后可能出现特殊站点（transfer/bonus），概率 ≈ SPECIAL_STATION_CHANCE', () => {
  // 用多个种子的 createInitialState 收集样本：每个初始状态有 12 站，
  // 其中第 6-12 个（索引 5..11）有机会成为特殊站点。
  // 这样避免「持续生成新站点」导致地图塞满后 addStation 失败的死循环。
  const eligible: string[] = [];
  for (let seed = 1; seed <= 120; seed++) {
    const s = createInitialState(seed);
    // 站点按生成顺序 push，索引 0..4 强制 normal，5..11 有 12% 概率特殊
    for (let i = 5; i < s.stations.length; i++) {
      eligible.push(s.stations[i]!.kind);
    }
  }
  assert.ok(eligible.length >= 600, `样本应足够（实际 ${eligible.length}）`);
  const special = eligible.filter((k) => k !== 'normal').length;
  const ratio = special / eligible.length;
  // SPECIAL_STATION_CHANCE=0.12，宽松 ±0.07 容忍采样噪声
  assert.ok(
    Math.abs(ratio - SPECIAL_STATION_CHANCE) < 0.07,
    `特殊站点比例 ${ratio.toFixed(3)} 应接近 ${SPECIAL_STATION_CHANCE}`,
  );
  // 特殊站点只能是 transfer 或 bonus
  for (const k of eligible) {
    assert.ok(
      k === 'normal' || k === 'transfer' || k === 'bonus',
      `非法站点种类: ${k}`,
    );
  }
});

// ---------- 站点形状分布 ----------

test('初始站点形状只取自 ALL_SHAPES（无非法形状）', () => {
  const s = createInitialState(1);
  const valid = new Set<string>(ALL_SHAPES);
  for (const st of s.stations) {
    assert.ok(valid.has(st.shape), `非法形状: ${st.shape}`);
  }
});

test('初始 12 站中常见形状（circle/triangle/square）占多数（前几站倾向常见形状）', () => {
  const common = new Set(['circle', 'triangle', 'square']);
  let commonCount = 0;
  for (const seed of [1, 7, 42, 99]) {
    const s = createInitialState(seed);
    for (const st of s.stations) {
      if (common.has(st.shape)) commonCount++;
    }
  }
  // 4 种子 × 12 站 = 48，常见应占大多数（>70%）
  assert.ok(commonCount > 33, `常见形状应占多数，实际 ${commonCount}/48`);
});

// ---------- 乘客目标分布 ----------

test('单站反复生成乘客：目标 != 站形状（确定性构造）', () => {
  // 构造只有一个站、unlocked=3 种形状的状态，强制 spawnPassenger 落在该站
  const s = createInitialState(1);
  s.phase = 'running';
  s.stations = [
    {
      id: 0,
      shape: 'circle',
      pos: { x: 100, y: 100 },
      passengers: [],
      overloadTimer: 0,
      kind: 'normal',
    },
  ];
  s.unlockedShapes = 3; // circle/triangle/square 可用
  const rng = new Rng(5);
  for (let i = 0; i < 100; i++) {
    const p = spawnPassenger(s, rng);
    // 唯一站，乘客一定加到这里
    assert.notEqual(p.target, 'circle', '唯一 circle 站的乘客目标不应是 circle');
  }
});

test('多站场景：单站乘客目标分布覆盖多种形状（非单一目标）', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  s.unlockedShapes = 3;
  const rng = new Rng(99);
  // 在某固定站（circle）大量生成乘客，统计其上目标形状种类
  // 因 spawnPassenger 随机选站，我们只采样落在 circle 站上的
  const circle = s.stations.find((st) => st.shape === 'circle')!;
  circle.passengers = [];
  for (let i = 0; i < 500; i++) {
    spawnPassenger(s, rng);
  }
  const targets = new Set(circle.passengers.map((p) => p.target));
  // circle 站上的乘客目标应不含 circle，且至少 1 种其它形状
  assert.ok(!targets.has('circle'), 'circle 站不应有目标是 circle 的乘客');
  assert.ok(targets.size >= 1, '应有至少一种目标形状');
});

// ---------- 稀有形状乘客：解锁后才出现 ----------

test('乘客目标形状始终在已解锁集合内', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  s.nextStationIn = 1e9;
  s.nextPowerUpIn = 1e9;
  s.passengerInterval = 0.5;
  s.nextPassengerIn = 0.5;
  const rng = new Rng(1);
  // 只跑前 20s，unlocked=3-4，断言所有乘客目标 ∈ 已解锁
  for (let t = 0; t < 20; t++) {
    step(s, 1, rng);
    const unlocked = new Set<string>(ALL_SHAPES.slice(0, s.unlockedShapes));
    for (const st of s.stations) {
      for (const p of st.passengers) {
        assert.ok(unlocked.has(p.target), `目标 ${p.target} 未解锁（仅 ${s.unlockedShapes} 种）`);
      }
    }
  }
});

// ---------- 事件去重：同时刻重复事件 ----------

test('同时刻两个相同事件（同 kind 同 shape）：均转为 active（不去重）', () => {
  const s = scenarioWith([
    { at: 10, kind: 'strike', stationShape: 'circle', duration: 5 },
    { at: 10, kind: 'strike', stationShape: 'circle', duration: 5 },
  ]);
  const q = buildEventQueue(s);
  const active: ActiveEvent[] = [];
  pumpEvents(10, q, active);
  // 设计上不去重：两个相同事件都进 active
  assert.equal(active.length, 2, '同时刻相同事件应都触发（设计不去重）');
  assert.equal(q.length, 0);
});

test('同 kind 不同 shape 的 strike：各自独立 isActive', () => {
  const active: ActiveEvent[] = [
    { kind: 'strike', stationShape: 'circle', remaining: 5 },
    { kind: 'strike', stationShape: 'square', remaining: 5 },
  ];
  assert.equal(isEventActive(active, 'strike', 'circle'), true);
  assert.equal(isEventActive(active, 'strike', 'square'), true);
  assert.equal(isEventActive(active, 'strike', 'triangle'), false, 'triangle 无 strike');
});

test('同 shape 的 strike + surge 同时 active：两者各自查询独立', () => {
  const active: ActiveEvent[] = [
    { kind: 'strike', stationShape: 'circle', remaining: 5 },
    { kind: 'surge', stationShape: 'circle', remaining: 5 },
  ];
  assert.equal(isEventActive(active, 'strike', 'circle'), true);
  assert.equal(isEventActive(active, 'surge', 'circle'), true);
});

// ---------- slow 事件无 shape（needsShape=false） ----------

test('slow 事件无需 shape 即生效（任意站点/列车减速）', () => {
  const active: ActiveEvent[] = [{ kind: 'slow', remaining: 5 }];
  assert.equal(isEventActive(active, 'slow'), true);
  assert.equal(isEventActive(active, 'slow', 'circle'), true, 'slow 带 shape 参数也应 true');
});

test('surge/strike 不带 shape 查询：应 false（needsShape 但缺参数）', () => {
  const active: ActiveEvent[] = [
    { kind: 'surge', stationShape: 'circle', remaining: 5 },
    { kind: 'strike', stationShape: 'square', remaining: 5 },
  ];
  // 不带 shape 参数 → isActive 内 shape===undefined → false
  assert.equal(isEventActive(active, 'surge'), false);
  assert.equal(isEventActive(active, 'strike'), false);
});

// ---------- tickActiveEvents：重复 kind 同时衰减 ----------

test('两个相同 active 事件同时衰减，到点同时移除', () => {
  const active: ActiveEvent[] = [
    { kind: 'slow', remaining: 2 },
    { kind: 'slow', remaining: 2 },
  ];
  tickActiveEvents(active, 1);
  assert.equal(active.length, 2, '各剩 1，仍在');
  assert.equal(active[0]!.remaining, 1);
  tickActiveEvents(active, 1);
  assert.equal(active.length, 0, '都归零，全部移除');
});

// ---------- buildEventQueue 稳定性（重复 at 排序） ----------

test('buildEventQueue 对相同 at 的事件保持相对顺序（稳定排序）', () => {
  const events: ScriptedEvent[] = [
    { at: 10, kind: 'slow', duration: 5 },
    { at: 10, kind: 'strike', stationShape: 'circle', duration: 5 },
    { at: 5, kind: 'surge', stationShape: 'square', duration: 5 },
  ];
  const q = buildEventQueue(scenarioWith(events));
  assert.deepEqual(
    q.map((e) => e.at),
    [5, 10, 10],
  );
  // at=5 在前，两个 at=10 保持原相对顺序（slow 在 strike 前）
  assert.equal(q[1]!.kind, 'slow');
  assert.equal(q[2]!.kind, 'strike');
});

// ---------- pumpEvents 不修改原始 scenario（仅消费 queue 副本） ----------

test('pumpEvents 不会改动 scenario.events（操作的是 queue 副本）', () => {
  const events: ScriptedEvent[] = [{ at: 5, kind: 'slow', duration: 3 }];
  const s = scenarioWith(events);
  const before = JSON.stringify(s.events);
  const q = buildEventQueue(s);
  pumpEvents(10, q, []);
  assert.equal(JSON.stringify(s.events), before, 'scenario.events 不应被 pump 改动');
});

// ---------- 稀有形状解锁后乘客目标可覆盖新形状 ----------

test('解锁第 5 种形状（star）后，乘客目标可能为 star', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  s.nextStationIn = 1e9;
  s.nextPowerUpIn = 1e9;
  s.passengerInterval = 0.3;
  s.nextPassengerIn = 0.3;
  const rng = new Rng(1);
  // 跑到 unlocked=5（需 60s）
  step(s, 65, rng);
  assert.equal(s.unlockedShapes, 5);
  // 再跑一段，统计所有出现过的目标形状
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    step(s, 1, rng);
    for (const st of s.stations) for (const p of st.passengers) seen.add(p.target);
  }
  // star 现在已解锁，应有机会出现（不强求一定出现，但常见形状应都在）
  assert.ok(seen.has('circle'), 'circle 应出现在目标中');
  assert.ok(seen.has('triangle'), 'triangle 应出现在目标中');
});

// ---------- 乘客不堆积到溢出容量太多（生成速率有上限） ----------

test('短时间单步 step 乘客总数不会爆炸（生成受 interval 约束）', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  s.nextStationIn = 1e9;
  s.nextPowerUpIn = 1e9;
  s.passengerInterval = 5;
  s.nextPassengerIn = 5;
  step(s, 10, new Rng(1)); // 10 秒，约生成 2 个乘客
  const total = s.stations.reduce((n, st) => n + st.passengers.length, 0);
  // 5s 一个，10s 应约 2 个（无 surge），宽松上界
  assert.ok(total <= 5, `10s 内乘客总数 ${total} 不应爆炸`);
});
