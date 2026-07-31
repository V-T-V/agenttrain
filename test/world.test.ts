// 世界地图 ×8 扩展的常量与规模验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_STATIONS,
  MAX_LINES,
  MAX_POWERUPS,
  MIN_STATION_DISTANCE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../src/game/config.ts';
import { createInitialState, defaultScenario } from '../src/game/state.ts';
import { createLine } from '../src/game/simulation.ts';

test('世界尺寸：宽×4、高×2', () => {
  assert.equal(WORLD_WIDTH, 3840); // 960 × 4
  assert.equal(WORLD_HEIGHT, 1200); // 600 × 2
});

test('世界面积 = 原来的 8 倍', () => {
  const original = 960 * 600;
  const now = WORLD_WIDTH * WORLD_HEIGHT;
  assert.equal(now / original, 8);
});

test('INITIAL_STATIONS 放大到 12', () => {
  assert.equal(INITIAL_STATIONS, 12);
});

test('MAX_LINES 放大到 24', () => {
  assert.equal(MAX_LINES, 24);
});

test('MAX_POWERUPS 放大到 8', () => {
  assert.equal(MAX_POWERUPS, 8);
});

test('MIN_STATION_DISTANCE 放大（避免大地图拥挤）', () => {
  assert.ok(MIN_STATION_DISTANCE > 110);
});

test('默认剧本送达目标 = 480（×8）', () => {
  assert.equal(defaultScenario().deliverTarget, 480);
});

test('createInitialState 在大地图上生成 INITIAL_STATIONS 个站点', () => {
  const s = createInitialState(7);
  assert.equal(s.stations.length, INITIAL_STATIONS);
  // 所有站点都在新世界范围内
  for (const st of s.stations) {
    assert.ok(st.pos.x >= 0 && st.pos.x <= WORLD_WIDTH);
    assert.ok(st.pos.y >= 0 && st.pos.y <= WORLD_HEIGHT);
  }
});

test('站点间距满足 MIN_STATION_DISTANCE', () => {
  const s = createInitialState(42);
  for (let i = 0; i < s.stations.length; i++) {
    for (let j = i + 1; j < s.stations.length; j++) {
      const a = s.stations[i]!;
      const b = s.stations[j]!;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      assert.ok(d >= MIN_STATION_DISTANCE, `站 ${i}-${j} 距离 ${d} < ${MIN_STATION_DISTANCE}`);
    }
  }
});

test('createLine 上限 = MAX_LINES(24)', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  // 补足站点
  while (s.stations.length < 28) {
    s.stations.push({
      id: s.nextStationId++,
      shape: 'circle',
      pos: { x: 100 + s.stations.length * 40, y: 200 },
      passengers: [],
      overloadTimer: 0,
      kind: 'normal' as const,
    });
  }
  let made = 0;
  for (let i = 0; i < s.stations.length - 1 && made < 30; i++) {
    if (createLine(s, s.stations[i]!.id, s.stations[i + 1]!.id)) made++;
  }
  assert.equal(made, MAX_LINES);
});
