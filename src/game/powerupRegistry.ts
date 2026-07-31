// 道具插件注册表 —— 让道具可插拔：加新道具只需在此注册一个对象，不改 usePowerUp/maybeSpawnPowerUp。
//
// 每个道具是一个 PowerUpDef，包含：
//   - type: 唯一标识（也是 inventory 的 key）
//   - name / emoji: 展示用
//   - duration: 生效时长（秒）；瞬时道具设 0
//   - onUse(state): 使用时的效果（原地修改 state）
//   - isActive(state): 当前是否生效（用于渲染提示）
//
// 这样 simulation/powerups.ts 不再写 switch/case，而是遍历注册表查找。

import { DOUBLE_SCORE_DURATION, MAGNET_DURATION, SPEED_BOOST_DURATION } from './config.ts';
import type { GameState } from './types.ts';

/** 道具定义（插件式）。 */
export interface PowerUpDef {
  type: string;
  name: string;
  emoji: string;
  /** 生效时长（秒）；0 = 瞬时效果。 */
  duration: number;
  /** 使用时的效果。返回是否成功。 */
  onUse: (state: GameState) => boolean;
  /** 当前是否生效（用于 HUD 提示）。 */
  isActive?: (state: GameState) => boolean;
}

/** 全部已注册道具。加新道具只需在此数组追加一项。 */
export const POWERUP_REGISTRY: readonly PowerUpDef[] = [
  {
    type: 'speed',
    name: '加速',
    emoji: '⚡',
    duration: SPEED_BOOST_DURATION,
    onUse: (s) => {
      s.speedBoostTimer = Math.max(s.speedBoostTimer, SPEED_BOOST_DURATION);
      return true;
    },
    isActive: (s) => s.speedBoostTimer > 0,
  },
  {
    type: 'clear',
    name: '清站',
    emoji: '🧹',
    duration: 0,
    onUse: (s) => {
      let target = s.stations[0] ?? null;
      let max = 0;
      for (const st of s.stations) {
        if (st.passengers.length > max) {
          max = st.passengers.length;
          target = st;
        }
      }
      if (target && max > 0) {
        target.passengers = [];
      }
      return true;
    },
  },
  {
    type: 'deliver',
    name: '急送',
    emoji: '📦',
    duration: 0,
    onUse: (s) => {
      for (const train of s.trains) {
        if (train.passengers.length > 0) {
          s.delivered += train.passengers.length;
          train.passengers = [];
        }
      }
      return true;
    },
  },
  {
    type: 'magnet',
    name: '磁铁',
    emoji: '🧲',
    duration: MAGNET_DURATION,
    onUse: (s) => {
      s.magnetTimer = Math.max(s.magnetTimer, MAGNET_DURATION);
      return true;
    },
    isActive: (s) => s.magnetTimer > 0,
  },
  {
    type: 'shield',
    name: '护盾',
    emoji: '🛡️',
    duration: 0,
    onUse: (s) => {
      for (const st of s.stations) {
        if (st.passengers.length >= s.capacity) st.overloadTimer = 0;
      }
      return true;
    },
  },
  {
    type: 'double',
    name: '双倍',
    emoji: '✨',
    duration: DOUBLE_SCORE_DURATION,
    onUse: (s) => {
      s.doubleScoreTimer = Math.max(s.doubleScoreTimer, DOUBLE_SCORE_DURATION);
      return true;
    },
    isActive: (s) => s.doubleScoreTimer > 0,
  },
];

/** 按 type 查道具定义。 */
const REGISTRY_MAP: Map<string, PowerUpDef> = new Map(POWERUP_REGISTRY.map((p) => [p.type, p]));

/** 按 type 查道具定义；未注册返回 undefined。 */
export function getPowerUpDef(type: string): PowerUpDef | undefined {
  return REGISTRY_MAP.get(type);
}

/** 全部已注册的道具 type 列表（供 maybeSpawnPowerUp 随机选）。 */
export function allPowerUpTypes(): readonly string[] {
  return POWERUP_REGISTRY.map((p) => p.type);
}
