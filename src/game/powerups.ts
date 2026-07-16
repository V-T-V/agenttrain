// 道具系统：地图生成、列车拾取、玩家使用。
// 全部是纯函数（接收 state + rng，原地修改 state），便于单测。

import {
  COMBO_MULTIPLIER_STEP,
  COMBO_STEP,
  COMBO_WINDOW,
  MAX_POWERUPS,
  POWERUP_INTERVAL,
  POWERUP_RADIUS,
  SPEED_BOOST_DURATION,
  SPEED_BOOST_MULTIPLIER,
  WORLD_HEIGHT,
  WORLD_MARGIN,
  WORLD_WIDTH,
} from './config.ts';
import { dist } from './geometry.ts';
import { trainPosition } from './simulation.ts';
import type { GameState, PowerUp, PowerUpType, Station, Vec2 } from './types.ts';
import type { Rng } from '../utils/rng.ts';

/** 道具类型 → 渲染用 emoji。 */
export const POWERUP_EMOJI: Record<PowerUpType, string> = {
  speed: '⚡',
  clear: '🧹',
  deliver: '📦',
};

/** 道具类型 → 中文名。 */
export const POWERUP_NAME: Record<PowerUpType, string> = {
  speed: '加速',
  clear: '清站',
  deliver: '急送',
};

/** 定时生成新道具（达到间隔且未超上限时）。 */
export function maybeSpawnPowerUp(state: GameState, dt: number, rng: Rng): void {
  if (state.powerUps.length >= MAX_POWERUPS) return;
  state.nextPowerUpIn -= dt;
  if (state.nextPowerUpIn > 0) return;
  state.nextPowerUpIn = POWERUP_INTERVAL;
  const types: PowerUpType[] = ['speed', 'clear', 'deliver'];
  const type = rng.pick(types);
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
        if ((state.inventory[pu.type] ?? 0) < 3) {
          state.inventory[pu.type] = (state.inventory[pu.type] ?? 0) + 1;
        }
        state.powerUps.splice(i, 1);
      }
    }
  }
}

/** 玩家使用一个道具。返回是否成功使用。 */
export function usePowerUp(state: GameState, type: PowerUpType): boolean {
  if ((state.inventory[type] ?? 0) <= 0) return false;
  state.inventory[type] = (state.inventory[type] ?? 0) - 1;
  switch (type) {
    case 'speed':
      state.speedBoostTimer = Math.max(state.speedBoostTimer, SPEED_BOOST_DURATION);
      return true;
    case 'clear':
      // 清空当前最堵的站点
      return clearWorstStation(state);
    case 'deliver':
      // 把所有车上乘客视为送达
      return deliverAllOnBoard(state);
  }
}

/** 清空最堵站点（乘客数最多且 >0 的站）。返回是否找到并清空。 */
function clearWorstStation(state: GameState): boolean {
  // 选乘客最多的一站
  let target: Station | undefined;
  let max = 0;
  for (const s of state.stations) {
    if (s.passengers.length > max) {
      max = s.passengers.length;
      target = s;
    }
  }
  if (!target || max === 0) return true; // 无乘客也算用掉（罕见）
  target.passengers = [];
  return true;
}

/** 把所有列车上的乘客全部送达结算。 */
function deliverAllOnBoard(state: GameState): boolean {
  for (const train of state.trains) {
    if (train.passengers.length > 0) {
      state.delivered += train.passengers.length;
      train.passengers = [];
    }
  }
  return true; // 即使没乘客也算用掉
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

/** 记录一次送达：连击 +1，刷新计时窗口。 */
export function registerComboHit(state: GameState): void {
  state.combo.count += 1;
  state.combo.timer = COMBO_WINDOW;
}
