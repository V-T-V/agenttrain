// 存档持久化层。
// 把 GameState + Rng 内部状态序列化到 localStorage，支持刷新续局。
// 设计参考 kids-games/src/core/storage.ts：单 key + 版本号 + 全程 try-catch 容错，
// 保证隐私模式/容量满/数据损坏等任何异常都不影响游戏可玩性。
//
// 不依赖 DOM 之外的任何 API；在 SSR/非浏览器环境（如 node:test）下自动降级为无操作。

import type { GameState } from './types.ts';

/** 存档在 localStorage 的 key。v1 是 schema 版本号，结构变更时递增并写迁移。 */
const SAVE_KEY = 'agenttrain-save-v1';
/** 当前存档 schema 版本。 */
const SAVE_VERSION = 1;

/** 存档信封：包含版本号、游戏状态、随机数发生器状态、保存时间戳。 */
interface SaveEnvelope {
  version: number;
  state: GameState;
  /** Rng.getState() 的快照，续局时用 Rng.fromState() 重建，保证随机序列连贯。 */
  rngState: number;
  savedAt: number;
}

/** 加载结果：成功返回 {state, rngState}，无存档或损坏返回 null。 */
export interface LoadResult {
  state: GameState;
  rngState: number;
}

/**
 * 在非浏览器环境（node:test / SSR）下没有 localStorage，提供惰性空实现。
 * 真实浏览器里 window.localStorage 存在。
 */
function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // 隐私模式 / 访问被拒（如 Safari 跨域 iframe）→ 视为无存储。
    return null;
  }
}

/** 保存游戏状态与 Rng 状态。任何异常都静默吞掉（存档失败不应中断游戏）。 */
export function saveGame(state: GameState, rngState: number): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const envelope: SaveEnvelope = {
      version: SAVE_VERSION,
      state,
      rngState,
      savedAt: Date.now(),
    };
    storage.setItem(SAVE_KEY, JSON.stringify(envelope));
  } catch {
    // 容量满 / 序列化异常 / 写入被拒 → 静默降级，游戏继续可玩。
  }
}

/**
 * 加载存档。
 * @returns 成功返回 {state, rngState}；无存档 / 损坏 / 版本不匹配返回 null。
 * 全程 try-catch：损坏 JSON、字段缺失、类型错乱都不抛错，只返回 null。
 */
export function loadGame(): LoadResult | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Partial<SaveEnvelope>;
    // 版本校验：未来 schema 升级时，此处加迁移分支（version 1 → 2 → ...）。
    if (envelope.version !== SAVE_VERSION) return null;
    if (!envelope.state || typeof envelope.rngState !== 'number') return null;
    // 基本完整性校验：state 必须有核心字段。
    const s = envelope.state;
    if (
      !Array.isArray(s.stations) ||
      !Array.isArray(s.lines) ||
      !Array.isArray(s.trains) ||
      typeof s.delivered !== 'number'
    ) {
      return null;
    }
    return { state: envelope.state, rngState: envelope.rngState };
  } catch {
    // JSON 解析失败 / 字段访问异常 → 当作无存档。
    return null;
  }
}

/** 清除存档（重开/游戏结束时调用）。 */
export function clearSave(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // 清除失败无需处理。
  }
}
