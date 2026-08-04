// 错误路径加固测试（D8）。
// 探测并锁定的边界/异常输入：
// - 空站点地图下 step / spawnPassenger 不崩溃
// - 无线路下 step 长时间运行只累积过载、最终 gameover
// - 负数 dt / 零 dt 被 step 短路（不推进时间）
// - 超大 dt（远超一段）单帧安全完成多次往返
// - 超载多站同时满载触发 gameover
// - createInitialState 不依赖外部、始终生成合法状态
// - usePowerUp 对未注册 type 返回 false
// - linePoints / stationIndex 对空站点安全
// - removeLine / lineEndpoints 对不存在 id 安全
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState, spawnPassenger } from '../src/game/state.ts';
import {
  createLine,
  lineEndpoints,
  linePoints,
  removeLine,
  step,
  stationIndex,
} from '../src/game/simulation.ts';
import { usePowerUp } from '../src/game/powerups.ts';
import { INITIAL_STATIONS } from '../src/game/config.ts';
import type { GameState, Station } from '../src/game/types.ts';

function runningState(seed = 1): GameState {
  const s = createInitialState(seed);
  s.phase = 'running';
  s.eventQueue = [];
  s.activeEvents = [];
  return s;
}

// ---------- 空地图加固 ----------

test('空站点地图下 spawnPassenger 不崩溃（返回占位乘客）', () => {
  const s = runningState();
  s.stations = [];
  const rng = new Rng(1);
  // 不应抛 Rng.pick 空数组错误
  let p: { target: string } | undefined;
  assert.doesNotThrow(() => {
    p = spawnPassenger(s, rng);
  });
  assert.ok(p && typeof p.target === 'string');
});

test('空站点地图下 step 不崩溃且推进时间', () => {
  const s = runningState();
  s.stations = [];
  s.lines = [];
  s.trains = [];
  s.nextPassengerIn = 0.1; // 触发 spawnPassenger 路径
  s.nextStationIn = Number.MAX_SAFE_INTEGER;
  const before = s.elapsed;
  assert.doesNotThrow(() => step(s, 1, new Rng(1)));
  assert.equal(s.elapsed, before + 1);
  assert.equal(s.phase, 'running', '无站点无线路不应 gameover');
});

// ---------- 无线路 ----------

test('无线路长时间 step 最终因站点过载 gameover', () => {
  const s = runningState(7);
  // 把所有站塞满，确保必然过载
  for (const st of s.stations) {
    st.passengers = Array.from({ length: s.capacity }, () => ({ target: 'circle' }));
  }
  const rng = new Rng(1);
  for (let i = 0; i < 2000 && s.phase === 'running'; i++) step(s, 0.1, rng);
  assert.equal(s.phase, 'gameover');
});

test('无线路无乘客：step 长时间保持 running（无过载源）', () => {
  const s = runningState(2);
  s.nextPassengerIn = Number.MAX_SAFE_INTEGER; // 不生成乘客
  s.nextStationIn = Number.MAX_SAFE_INTEGER;
  const rng = new Rng(1);
  for (let i = 0; i < 100; i++) step(s, 0.5, rng);
  assert.equal(s.phase, 'running');
});

// ---------- dt 异常 ----------

test('step 负数 dt 被短路，时间不推进', () => {
  const s = runningState();
  const before = s.elapsed;
  step(s, -5, new Rng(1));
  assert.equal(s.elapsed, before, '负 dt 应被拦截');
});

test('step 零 dt 被短路', () => {
  const s = runningState();
  const before = s.elapsed;
  step(s, 0, new Rng(1));
  assert.equal(s.elapsed, before, '零 dt 应被拦截');
});

test('step NaN dt 被短路', () => {
  const s = runningState();
  const before = s.elapsed;
  step(s, NaN, new Rng(1));
  assert.equal(s.elapsed, before, 'NaN dt 应被拦截');
});

test('step Infinity dt 被短路（防 spawnTimers 死循环）', () => {
  const s = runningState();
  const before = s.elapsed;
  assert.doesNotThrow(() => step(s, Infinity, new Rng(1)));
  assert.equal(s.elapsed, before, 'Infinity dt 应被拦截不推进');
});

test('step 超大有限 dt（10000s）单帧安全完成', () => {
  const s = runningState();
  // 建一条线让列车跑
  const [a, b] = s.stations;
  if (a && b) createLine(s, a.id, b.id);
  assert.doesNotThrow(() => step(s, 10000, new Rng(1)));
  // 要么 running 要么 gameover，但不应崩溃或卡死
  assert.ok(s.phase === 'running' || s.phase === 'gameover');
});

// ---------- 超载 ----------

test('多站同时满载：任一超 grace 即 gameover', () => {
  const s = runningState(3);
  // 三个站同时满载
  for (let i = 0; i < 3 && i < s.stations.length; i++) {
    const st = s.stations[i]!;
    st.passengers = Array.from({ length: s.capacity }, () => ({ target: 'circle' }));
  }
  s.nextPassengerIn = Number.MAX_SAFE_INTEGER;
  s.nextStationIn = Number.MAX_SAFE_INTEGER;
  const rng = new Rng(1);
  for (let i = 0; i < 500 && s.phase === 'running'; i++) step(s, 0.1, rng);
  assert.equal(s.phase, 'gameover');
});

test('单站恰好满载容量边界（capacity 个）触发过载计时', () => {
  const s = runningState(4);
  const st = s.stations[0]!;
  st.passengers = Array.from({ length: s.capacity }, () => ({ target: 'circle' }));
  s.nextPassengerIn = Number.MAX_SAFE_INTEGER;
  s.nextStationIn = Number.MAX_SAFE_INTEGER;
  step(s, 0.5, new Rng(1));
  assert.ok(st.overloadTimer > 0, 'capacity 个乘客应累积 overloadTimer');
});

// ---------- createInitialState 健壮性 ----------

test('createInitialState 各种种子都生成合法状态', () => {
  for (const seed of [0, 1, 42, 9999, 2147483647]) {
    const s = createInitialState(seed);
    assert.equal(s.phase, 'ready');
    assert.ok(s.stations.length > 0, `种子 ${seed} 应生成站点`);
    assert.ok(s.stations.length <= INITIAL_STATIONS);
    assert.equal(s.lines.length, 0);
    assert.equal(s.trains.length, 0);
    assert.ok(s.capacity > 0);
    assert.ok(s.overloadGrace > 0);
    assert.ok(s.trainSpeed > 0);
    // 站点 id 唯一
    const ids = s.stations.map((st) => st.id);
    assert.equal(new Set(ids).size, ids.length);
    // 站点坐标在地图范围内
    for (const st of s.stations) {
      assert.ok(Number.isFinite(st.pos.x) && Number.isFinite(st.pos.y));
    }
  }
});

test('createInitialState 种子 0 不退化（黄金分割常数兜底）', () => {
  const s = createInitialState(0);
  // 种子 0 应被归一化，仍能生成确定性序列
  const s2 = createInitialState(0);
  assert.deepEqual(
    s.stations.map((st) => st.pos),
    s2.stations.map((st) => st.pos),
    '相同种子 0 应产生相同站点布局',
  );
});

// ---------- usePowerUp 未注册 ----------

test('usePowerUp 未注册的 type 返回 false 不抛错', () => {
  const s = runningState();
  // @ts-expect-error 故意传未注册的 type
  assert.equal(usePowerUp(s, 'nonexistent'), false);
  assert.equal(s.delivered, 0);
});

// ---------- 空结构辅助函数 ----------

test('空站点下 stationIndex 返回空 Map', () => {
  const s = runningState();
  s.stations = [];
  assert.equal(stationIndex(s).size, 0);
});

test('空站点下 linePoints 对含缺站线路返回空数组', () => {
  const s = runningState();
  s.stations = [];
  // 手工塞一条引用不存在站点的线路
  s.lines.push({ id: 1, color: 'red', stops: [999, 1000] });
  const pts = linePoints(s, s.lines[0]!);
  assert.deepEqual(pts, []);
});

test('removeLine 不存在 id 不抛错', () => {
  const s = runningState();
  assert.doesNotThrow(() => removeLine(s, 99999));
});

test('lineEndpoints 不存在 id 返回空对象', () => {
  const s = runningState();
  assert.deepEqual(lineEndpoints(s, -1), {});
});

// ---------- 站点乘客目标合法性 ----------

test('createInitialState 站点乘客列表初始为空', () => {
  const s = createInitialState(1);
  for (const st of s.stations) {
    assert.equal(st.passengers.length, 0);
    assert.equal(st.overloadTimer, 0);
  }
});

test('spawnPassenger 多次调用目标形状都在已解锁集合内', () => {
  const s = runningState(5);
  const rng = new Rng(9);
  for (let i = 0; i < 50; i++) {
    const p = spawnPassenger(s, rng);
    const valid = ['circle', 'triangle', 'square', 'diamond', 'star'];
    assert.ok(valid.includes(p.target), `非法目标形状 ${p.target}`);
  }
});

test('addStation 超出地图容量时返回 false（不崩溃）', async () => {
  const { addStation } = await import('../src/game/state.ts');
  const s = runningState(1);
  // 把地图塞满到无法再放（极多站点）
  for (let i = 0; i < 5000; i++) {
    s.stations.push({
      id: s.nextStationId++,
      shape: 'circle',
      pos: { x: 100 + (i % 50) * 60, y: 100 + Math.floor(i / 50) * 60 },
      passengers: [],
      overloadTimer: 0,
      kind: 'normal' as const,
    });
  }
  // 尝试多次 addStation，至少有一次因找不到空位返回 false
  let anyFalse = false;
  const rng = new Rng(1);
  for (let i = 0; i < 100; i++) {
    if (!addStation(s, rng)) anyFalse = true;
  }
  // 地图极拥挤时应至少一次返回 false（spawnStationCandidate 60 次重试失败）
  assert.ok(anyFalse, '极端拥挤地图应至少一次 addStation 返回 false');
});

test('Station 类型字段完整性', () => {
  const s = createInitialState(1);
  for (const st of s.stations) {
    assert.ok(typeof st.id === 'number');
    assert.ok(['circle', 'triangle', 'square', 'diamond', 'star'].includes(st.shape));
    assert.ok(typeof st.pos.x === 'number' && typeof st.pos.y === 'number');
    assert.ok(Array.isArray(st.passengers));
    assert.ok(typeof st.overloadTimer === 'number');
    assert.ok(['normal', 'transfer', 'bonus'].includes(st.kind));
  }
});
