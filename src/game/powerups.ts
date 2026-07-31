// 道具系统：地图生成、列车拾取、玩家使用。
// 全部是纯函数（接收 state + rng，原地修改 state），便于单测。

import {
  COMBO_MULTIPLIER_STEP,
  COMBO_STEP,
  COMBO_WINDOW,
  MAX_INVENTORY,
  MAX_POWERUPS,
  POWERUP_INTERVAL,
  POWERUP_RADIUS,
  SPEED_BOOST_MULTIPLIER,
  WORLD_HEIGHT,
  WORLD_MARGIN,
  WORLD_WIDTH,
} from './config.ts';
import { dist } from './geometry.ts';
import { trainPosition } from './simulation.ts';
import type { GameState, PowerUp, PowerUpType, Vec2 } from './types.ts';
import type { Rng } from '../utils/rng.ts';
import { allPowerUpTypes, getPowerUpDef } from './powerupRegistry.ts';

/** 道具类型 → 渲染用 emoji。 */
export const POWERUP_EMOJI: Record<PowerUpType, string> = {
  speed: '⚡',
  clear: '🧹',
  deliver: '📦',
  magnet: '🧲',
  shield: '🛡️',
  double: '✨',
};

/** 道具类型 → 中文名。 */
export const POWERUP_NAME: Record<PowerUpType, string> = {
  speed: '加速',
  clear: '清站',
  deliver: '急送',
  magnet: '磁铁',
  shield: '护盾',
  double: '双倍',
};

/** 定时生成新道具（达到间隔且未超上限时）。 */
export function maybeSpawnPowerUp(state: GameState, dt: number, rng: Rng): void {
  if (state.powerUps.length >= MAX_POWERUPS) return;
  state.nextPowerUpIn -= dt;
  if (state.nextPowerUpIn > 0) return;
  state.nextPowerUpIn = POWERUP_INTERVAL;
  const types = allPowerUpTypes();
  const type = rng.pick([...types]) as PowerUpType;
  const pos = randomFreeSpot(state, rng);
  if (!pos) return;
  const pu: PowerUp = { id: state.nextPowerUpId++, type, pos };
  state.powerUps.push(pu);
}

/** 在地图上找一个远离所有站点的空位（避免叠在站点上）。 */
function randomFreeSpot(state: GameState, rng: Rng): Vec2 | null {
  for (let i = 0; i < 30; i++) {
    const pos = {
      x: rng.range(WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN),
      y: rng.range(WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN),
    };
    const tooClose = state.stations.some((s) => dist(s.pos, pos) < 60);
    if (!tooClose) return pos;
  }
  return null;
}

/** 列车经过道具时自动拾取：从 powerUps 移除，加入 inventory（受上限）。 */
export function pickupPowerUps(state: GameState): void {
  if (state.powerUps.length === 0) return;
  for (const train of state.trains) {
    const tp = trainPosition(state, train);
    for (let i = state.powerUps.length - 1; i >= 0; i--) {
      const pu = state.powerUps[i]!;
      if (dist(pu.pos, tp) < POWERUP_RADIUS + 8) {
        if ((state.inventory[pu.type] ?? 0) < MAX_INVENTORY) {
          state.inventory[pu.type] = (state.inventory[pu.type] ?? 0) + 1;
        }
        state.powerUps.splice(i, 1);
      }
    }
  }
}

/** 玩家使用一个道具。返回是否成功使用。通过注册表分发，加新道具无需改此函数。 */
export function usePowerUp(state: GameState, type: PowerUpType): boolean {
  if ((state.inventory[type] ?? 0) <= 0) return false;
  const def = getPowerUpDef(type);
  if (!def) return false;
  state.inventory[type] = (state.inventory[type] ?? 0) - 1;
  return def.onUse(state);
}

/** 加速道具当前是否生效。 */
export function isSpeedBoostActive(state: GameState): boolean {
  return state.speedBoostTimer > 0;
}

/** 加速倍率（生效时为 SPEED_BOOST_MULTIPLIER，否则 1）。 */
export function speedBoostMultiplier(state: GameState): number {
  return isSpeedBoostActive(state) ? SPEED_BOOST_MULTIPLIER : 1;
}

/** 每帧衰减加速计时器（归零即失效）。 */
export function tickSpeedBoost(state: GameState, dt: number): void {
  if (state.speedBoostTimer > 0) {
    state.speedBoostTimer = Math.max(0, state.speedBoostTimer - dt);
  }
}

// ===== 磁铁 / 双倍得分（扩展道具） =====

/** 磁铁道具当前是否生效（生效时列车上车忽略「目标形状可达」检查）。 */
export function isMagnetActive(state: GameState): boolean {
  return state.magnetTimer > 0;
}

/** 每帧衰减磁铁计时器。 */
export function tickMagnet(state: GameState, dt: number): void {
  if (state.magnetTimer > 0) state.magnetTimer = Math.max(0, state.magnetTimer - dt);
}

/** 双倍得分道具当前是否生效（生效时送达得分 ×2）。 */
export function isDoubleScoreActive(state: GameState): boolean {
  return state.doubleScoreTimer > 0;
}

/** 每帧衰减双倍得分计时器。 */
export function tickDoubleScore(state: GameState, dt: number): void {
  if (state.doubleScoreTimer > 0) state.doubleScoreTimer = Math.max(0, state.doubleScoreTimer - dt);
}

/** 当前得分倍率（连击倍率 × 双倍道具，若生效）。 */
export function scoreMultiplier(state: GameState): number {
  let mult = comboMultiplier(state);
  if (isDoubleScoreActive(state)) mult *= 2;
  return mult;
}

// ===== 连击系统 =====

/** 当前连击倍率：1 + floor(count / COMBO_STEP) * COMBO_MULTIPLIER_STEP。 */
export function comboMultiplier(state: GameState): number {
  if (state.combo.count <= 0) return 1;
  return 1 + Math.floor(state.combo.count / COMBO_STEP) * COMBO_MULTIPLIER_STEP;
}

/** 每帧衰减连击计时器，归零则连击清零。 */
export function tickCombo(state: GameState, dt: number): void {
  if (state.combo.count === 0) return;
  state.combo.timer -= dt;
  if (state.combo.timer <= 0) {
    state.combo.count = 0;
    state.combo.timer = 0;
  }
}

/** 记录一次送达：连击 +1，刷新计时窗口，跟踪本局最高连击。 */
export function registerComboHit(state: GameState): void {
  state.combo.count += 1;
  state.combo.timer = COMBO_WINDOW;
  if (state.combo.count > state.maxCombo) state.maxCombo = state.combo.count;
}
