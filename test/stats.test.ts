// 本局统计模块单测：派生数据正确性（效率/最长线路/完成度/连击倍率）+ 格式化函数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import { createLine, extendLine } from '../src/game/simulation.ts';
import {
  computeRunStats,
  formatCompletion,
  formatDuration,
  formatEfficiency,
} from '../src/game/stats.ts';
import type { GameState } from '../src/game/types.ts';

function runningState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  return s;
}

// ---------- 基础派生 ----------

test('computeRunStats：空状态基线值正确', () => {
  const s = runningState();
  const st = computeRunStats(s, 0, 0);
  assert.equal(st.delivered, 0);
  assert.equal(st.durationSec, 0);
  assert.equal(st.efficiency, 0, '0 分钟时效率为 0');
  assert.equal(st.longestLineStops, 0);
  assert.equal(st.peakCombo, 0);
  assert.equal(st.activeLines, 0);
  assert.equal(st.trainCount, 0);
  assert.equal(st.completion, 0);
  assert.equal(st.reachedTarget, false);
});

test('delivered 与 elapsed 直接反映在 stats 上', () => {
  const s = runningState();
  s.delivered = 120;
  s.elapsed = 180; // 3 分钟
  const st = computeRunStats(s, 2, 3);
  assert.equal(st.delivered, 120);
  assert.equal(st.durationSec, 180);
  assert.equal(st.efficiency, 40, '120 人 / 3 分钟 = 40 人/分钟');
});

test('efficiency：1 分钟送达 60 人 = 60/分钟', () => {
  const s = runningState();
  s.delivered = 60;
  s.elapsed = 60;
  assert.equal(computeRunStats(s, 0, 0).efficiency, 60);
});

test('efficiency：30 秒送达 10 人 = 20/分钟', () => {
  const s = runningState();
  s.delivered = 10;
  s.elapsed = 30; // 0.5 分钟
  assert.equal(computeRunStats(s, 0, 0).efficiency, 20);
});

// ---------- 最长线路 ----------

test('longestLineStops：取所有线路中站点最多的一条', () => {
  const s = runningState();
  const [a, b, c, d, e] = s.stations;
  assert.ok(a && b && c && d && e);
  createLine(s, a.id, b.id); // 2 站
  const line2 = s.lines[0]!;
  createLine(s, c.id, d.id); // 2 站
  extendLine(s, s.lines[1]!.id, e.id, false); // 3 站
  const st = computeRunStats(s, 2, 0);
  assert.equal(st.longestLineStops, 3);
  assert.equal(st.activeLines, 2);
  // longestLineLength 应 > 0（有真实坐标）
  assert.ok(st.longestLineLength > 0);
  void line2;
});

test('longestLineLength：站点距离越大，长度越大', () => {
  const s1 = runningState();
  const s2 = runningState();
  // 两条相同站点、不同距离
  const [a1, b1] = s1.stations;
  const [a2, b2] = s2.stations;
  a1!.pos = { x: 0, y: 0 };
  b1!.pos = { x: 100, y: 0 };
  a2!.pos = { x: 0, y: 0 };
  b2!.pos = { x: 500, y: 0 };
  createLine(s1, a1!.id, b1!.id);
  createLine(s2, a2!.id, b2!.id);
  const len1 = computeRunStats(s1, 1, 0).longestLineLength;
  const len2 = computeRunStats(s2, 1, 0).longestLineLength;
  assert.ok(len2 > len1, '500px 线路应长于 100px');
  assert.ok(Math.abs(len1 - 100) < 1e-6);
  assert.ok(Math.abs(len2 - 500) < 1e-6);
});

// ---------- 完成度 ----------

test('completion：达成目标时 = 1', () => {
  const s = runningState();
  s.delivered = s.scenario.deliverTarget;
  assert.equal(computeRunStats(s, 0, 0).completion, 1);
  assert.equal(computeRunStats(s, 0, 0).reachedTarget, true);
});

test('completion：超额完成 > 1', () => {
  const s = runningState();
  s.delivered = s.scenario.deliverTarget * 2;
  const st = computeRunStats(s, 0, 0);
  assert.ok(st.completion > 1.9);
  assert.ok(st.reachedTarget);
});

test('completion：半程 = 0.5', () => {
  const s = runningState();
  s.delivered = Math.floor(s.scenario.deliverTarget / 2);
  const st = computeRunStats(s, 0, 0);
  assert.ok(Math.abs(st.completion - 0.5) < 0.01);
  assert.equal(st.reachedTarget, false);
});

// ---------- 连击倍率 ----------

test('peakComboMultiplier：0 连击为 1，每 5 连 +0.5', () => {
  const s = runningState();
  assert.equal(computeRunStats(s, 0, 0).peakComboMultiplier, 1);
  s.maxCombo = 5;
  assert.equal(computeRunStats(s, 0, 0).peakComboMultiplier, 1.5);
  s.maxCombo = 10;
  assert.equal(computeRunStats(s, 0, 0).peakComboMultiplier, 2);
  s.maxCombo = 100;
  assert.equal(computeRunStats(s, 0, 0).peakComboMultiplier, 11);
});

test('peakCombo 直接来自 state.maxCombo', () => {
  const s = runningState();
  s.maxCombo = 42;
  assert.equal(computeRunStats(s, 0, 0).peakCombo, 42);
});

// ---------- 线路 / 道具 计数 ----------

test('linesBuilt / powerUpsUsed 直接透传', () => {
  const s = runningState();
  const st = computeRunStats(s, 7, 9);
  assert.equal(st.linesBuilt, 7);
  assert.equal(st.powerUpsUsed, 9);
});

test('activeLines 反映当前未删除线路数', () => {
  const s = runningState();
  const [a, b, c, d] = s.stations;
  createLine(s, a!.id, b!.id);
  createLine(s, c!.id, d!.id);
  assert.equal(computeRunStats(s, 2, 0).activeLines, 2);
});

test('trainCount 反映列车总数（每条线一列）', () => {
  const s = runningState();
  const [a, b, c, d] = s.stations;
  createLine(s, a!.id, b!.id);
  createLine(s, c!.id, d!.id);
  assert.equal(computeRunStats(s, 2, 0).trainCount, 2);
});

// ---------- 格式化函数 ----------

test('formatDuration：秒 → mm:ss', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(60), '1:00');
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3661), '61:01');
});

test('formatDuration：负数 clamp 到 0', () => {
  assert.equal(formatDuration(-10), '0:00');
});

test('formatDuration：小数向下取整', () => {
  assert.equal(formatDuration(59.9), '0:59');
  assert.equal(formatDuration(60.5), '1:00');
});

test('formatEfficiency：一位小数', () => {
  assert.equal(formatEfficiency(40), '40.0');
  assert.equal(formatEfficiency(33.333), '33.3');
  assert.equal(formatEfficiency(0), '0.0');
});

test('formatCompletion：百分比', () => {
  assert.equal(formatCompletion(0), '0%');
  assert.equal(formatCompletion(0.5), '50%');
  assert.equal(formatCompletion(1), '100%');
  assert.equal(formatCompletion(2), '200%');
});

// ---------- 边界 ----------

test('deliverTarget 透传', () => {
  const s = runningState();
  assert.equal(computeRunStats(s, 0, 0).deliverTarget, s.scenario.deliverTarget);
});

test('reachedTarget：恰好等于目标算达成', () => {
  const s = runningState();
  s.delivered = s.scenario.deliverTarget;
  assert.equal(computeRunStats(s, 0, 0).reachedTarget, true);
});

test('reachedTarget：差 1 不算达成', () => {
  const s = runningState();
  s.delivered = s.scenario.deliverTarget - 1;
  assert.equal(computeRunStats(s, 0, 0).reachedTarget, false);
});
