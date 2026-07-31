// 道具深层单测：每个道具的精确生效时长、刷新(叠加)行为、计时器互相独立、
// usePowerUp 与注册表/库存的边界。补充 powerups.test.ts / specials.test.ts。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import {
  DOUBLE_SCORE_DURATION,
  MAGNET_DURATION,
  SPEED_BOOST_DURATION,
  SPEED_BOOST_MULTIPLIER,
} from '../src/game/config.ts';
import {
  comboMultiplier,
  isDoubleScoreActive,
  isMagnetActive,
  isSpeedBoostActive,
  pickupPowerUps,
  scoreMultiplier,
  speedBoostMultiplier,
  tickCombo,
  tickDoubleScore,
  tickMagnet,
  tickSpeedBoost,
  usePowerUp,
} from '../src/game/powerups.ts';
import { createLine } from '../src/game/simulation.ts';
import type { GameState } from '../src/game/types.ts';

function runningState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  return s;
}

// ---------- 每个道具的精确生效时长 ----------

test('加速道具：使用后 speedBoostTimer = SPEED_BOOST_DURATION(8s)', () => {
  const s = runningState();
  s.inventory.speed = 1;
  usePowerUp(s, 'speed');
  assert.ok(Math.abs(s.speedBoostTimer - SPEED_BOOST_DURATION) < 1e-9);
});

test('磁铁道具：使用后 magnetTimer = MAGNET_DURATION(8s)', () => {
  const s = runningState();
  s.inventory.magnet = 1;
  usePowerUp(s, 'magnet');
  assert.ok(Math.abs(s.magnetTimer - MAGNET_DURATION) < 1e-9);
});

test('双倍道具：使用后 doubleScoreTimer = DOUBLE_SCORE_DURATION(10s)', () => {
  const s = runningState();
  s.inventory.double = 1;
  usePowerUp(s, 'double');
  assert.ok(Math.abs(s.doubleScoreTimer - DOUBLE_SCORE_DURATION) < 1e-9);
});

test('加速期间 speedBoostMultiplier = 2，过期回落 1', () => {
  const s = runningState();
  assert.equal(speedBoostMultiplier(s), 1);
  s.speedBoostTimer = 1;
  assert.equal(speedBoostMultiplier(s), SPEED_BOOST_MULTIPLIER);
  s.speedBoostTimer = 0;
  assert.equal(speedBoostMultiplier(s), 1);
});

// ---------- 刷新 / 叠加 ----------

test('加速生效期间再次使用：刷新到满时长（不缩短）', () => {
  const s = runningState();
  s.inventory.speed = 2;
  usePowerUp(s, 'speed'); // timer = 8
  // 消耗 5s，剩 3s
  tickSpeedBoost(s, 5);
  assert.ok(Math.abs(s.speedBoostTimer - 3) < 1e-9);
  // 再次使用：取 max(3, 8) = 8
  usePowerUp(s, 'speed');
  assert.ok(
    Math.abs(s.speedBoostTimer - SPEED_BOOST_DURATION) < 1e-9,
    '刷新应恢复到满时长',
  );
});

test('磁铁生效期间再次使用：刷新到满时长', () => {
  const s = runningState();
  s.inventory.magnet = 2;
  usePowerUp(s, 'magnet'); // timer = 8
  tickMagnet(s, 6); // 剩 2s
  usePowerUp(s, 'magnet'); // max(2,8)=8
  assert.ok(Math.abs(s.magnetTimer - MAGNET_DURATION) < 1e-9);
});

test('双倍生效期间再次使用：刷新到满时长', () => {
  const s = runningState();
  s.inventory.double = 2;
  usePowerUp(s, 'double'); // timer = 10
  tickDoubleScore(s, 7); // 剩 3s
  usePowerUp(s, 'double'); // max(3,10)=10
  assert.ok(Math.abs(s.doubleScoreTimer - DOUBLE_SCORE_DURATION) < 1e-9);
});

// ---------- 计时器互相独立 ----------

test('加速/磁铁/双倍计时器互相独立衰减', () => {
  const s = runningState();
  s.speedBoostTimer = 8;
  s.magnetTimer = 8;
  s.doubleScoreTimer = 10;
  // 各衰减不同时长
  tickSpeedBoost(s, 2);
  tickMagnet(s, 3);
  tickDoubleScore(s, 4);
  assert.ok(Math.abs(s.speedBoostTimer - 6) < 1e-9);
  assert.ok(Math.abs(s.magnetTimer - 5) < 1e-9);
  assert.ok(Math.abs(s.doubleScoreTimer - 6) < 1e-9);
  assert.ok(isSpeedBoostActive(s));
  assert.ok(isMagnetActive(s));
  assert.ok(isDoubleScoreActive(s));
});

test('衰减到 0 后 isXxxActive 全部为 false', () => {
  const s = runningState();
  s.speedBoostTimer = 0.4;
  s.magnetTimer = 0.4;
  s.doubleScoreTimer = 0.4;
  tickSpeedBoost(s, 0.5);
  tickMagnet(s, 0.5);
  tickDoubleScore(s, 0.5);
  assert.equal(isSpeedBoostActive(s), false);
  assert.equal(isMagnetActive(s), false);
  assert.equal(isDoubleScoreActive(s), false);
  // 计时器被 clamp 到 0，不为负
  assert.equal(s.speedBoostTimer, 0);
  assert.equal(s.magnetTimer, 0);
  assert.equal(s.doubleScoreTimer, 0);
});

test('tickXxxTimer 在计时器已为 0 时保持 0（不越界）', () => {
  const s = runningState();
  tickSpeedBoost(s, 100);
  tickMagnet(s, 100);
  tickDoubleScore(s, 100);
  assert.equal(s.speedBoostTimer, 0);
  assert.equal(s.magnetTimer, 0);
  assert.equal(s.doubleScoreTimer, 0);
});

// ---------- 连击 × 双倍冲突（scoreMultiplier 叠加） ----------

test('scoreMultiplier：连击倍率 × 双倍道具（无连击基线为 1）', () => {
  const s = runningState();
  assert.equal(scoreMultiplier(s), 1);
  s.doubleScoreTimer = 5;
  assert.equal(scoreMultiplier(s), 2, '无连击 + 双倍 = 2');
});

test('scoreMultiplier：连击 + 双倍道具叠乘（10连=2倍 ×2 =4）', () => {
  const s = runningState();
  for (let i = 0; i < 10; i++) s.combo.count++;
  s.combo.timer = 3;
  assert.equal(comboMultiplier(s), 2);
  s.doubleScoreTimer = 5;
  assert.equal(scoreMultiplier(s), 4, '2 × 2 = 4');
});

test('连击窗口超时后 comboMultiplier 回落为 1（与双倍独立）', () => {
  const s = runningState();
  s.combo.count = 10;
  s.combo.timer = 0.1;
  tickCombo(s, 0.5);
  assert.equal(s.combo.count, 0, '连击窗口超时应清零');
  assert.equal(comboMultiplier(s), 1);
});

// ---------- usePowerUp 库存边界 ----------

test('usePowerUp deliver：多列车同时结算', () => {
  const s = runningState();
  // 建两条线（各一列车）
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  createLine(s, s.stations[2]!.id, s.stations[3]!.id);
  s.trains[0]!.passengers = [{ target: 'square' }, { target: 'square' }];
  s.trains[1]!.passengers = [{ target: 'square' }];
  s.inventory.deliver = 1;
  const before = s.delivered;
  assert.equal(usePowerUp(s, 'deliver'), true);
  assert.equal(s.delivered, before + 3, '两列车共 3 名乘客全部结算');
  assert.equal(s.trains[0]!.passengers.length, 0);
  assert.equal(s.trains[1]!.passengers.length, 0);
});

test('usePowerUp deliver：无列车时不报错', () => {
  const s = runningState();
  s.inventory.deliver = 1;
  assert.equal(usePowerUp(s, 'deliver'), true);
  assert.equal(s.inventory.deliver, 0);
});

test('usePowerUp clear：多个站乘客相同时取首个（顺序确定）', () => {
  const s = runningState();
  s.stations[0]!.passengers = Array.from({ length: 3 }, () => ({ target: 'square' }));
  s.stations[1]!.passengers = Array.from({ length: 3 }, () => ({ target: 'circle' }));
  s.inventory.clear = 1;
  usePowerUp(s, 'clear');
  // 两站都 3 个，取第一个遇到的 max（0 号站先）
  assert.equal(s.stations[0]!.passengers.length, 0, '0 号站先遇到应被清空');
});

test('usePowerUp clear：所有站为空时仍返回 true（无副作用）', () => {
  const s = runningState();
  for (const st of s.stations) st.passengers = [];
  s.inventory.clear = 1;
  assert.equal(usePowerUp(s, 'clear'), true);
  assert.equal(s.inventory.clear, 0);
});

test('usePowerUp shield：清零所有满载站的计时器', () => {
  const s = runningState();
  s.stations[0]!.passengers = Array.from({ length: s.capacity }, () => ({ target: 'square' }));
  s.stations[1]!.passengers = Array.from({ length: s.capacity }, () => ({ target: 'square' }));
  s.stations[0]!.overloadTimer = 4;
  s.stations[1]!.overloadTimer = 5;
  s.inventory.shield = 1;
  usePowerUp(s, 'shield');
  assert.equal(s.stations[0]!.overloadTimer, 0);
  assert.equal(s.stations[1]!.overloadTimer, 0);
  assert.equal(s.inventory.shield, 0);
});

test('usePowerUp 同一道具连续用多次：库存逐次递减', () => {
  const s = runningState();
  s.inventory.speed = 3;
  assert.equal(usePowerUp(s, 'speed'), true);
  assert.equal(usePowerUp(s, 'speed'), true);
  assert.equal(usePowerUp(s, 'speed'), true);
  assert.equal(s.inventory.speed, 0);
  assert.equal(usePowerUp(s, 'speed'), false, '用完后应失败');
});

// ---------- 拾取位置边界 ----------

test('pickupPowerUps：道具在列车位置半径外不被拾取', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a.pos = { x: 0, y: 0 };
  b.pos = { x: 100, y: 0 };
  createLine(s, a.id, b.id); // 列车在 (0,0) 附近
  // 放在远离列车的位置（>22px，阈值 POWERUP_RADIUS(14)+8=22）
  s.powerUps = [{ id: 0, type: 'speed', pos: { x: 100, y: 100 } }];
  pickupPowerUps(s);
  assert.equal(s.powerUps.length, 1, '远处道具不应被拾取');
  assert.equal(s.inventory.speed, 0);
});

test('pickupPowerUps：多列车同时经过同一道具，只被拾一次', () => {
  const s = runningState();
  const [a, b, c] = s.stations;
  assert.ok(a && b && c);
  a.pos = { x: 0, y: 0 };
  b.pos = { x: 100, y: 0 };
  // 两条线共享起点 a，列车都在 (0,0)
  createLine(s, a.id, b.id);
  createLine(s, a.id, c!.id);
  s.powerUps = [{ id: 0, type: 'speed', pos: { x: 5, y: 0 } }];
  pickupPowerUps(s);
  assert.equal(s.powerUps.length, 0, '道具应被移除');
  assert.ok(s.inventory.speed <= 1, '库存至多 +1（不重复）');
});
