// 游戏状态构造与站点/乘客生成。
// 这里的函数仍是「纯」的：接收 Rng 与现有 state，返回新 state 或就地可预测地修改。
// 不触碰 DOM。

import {
  INITIAL_STATIONS,
  MIN_STATION_DISTANCE,
  POWERUP_INTERVAL,
  SPECIAL_STATION_CHANCE,
  STATION_INTERVAL,
  WORLD_HEIGHT,
  WORLD_MARGIN,
  WORLD_WIDTH,
} from './config.ts';
import {
  ALL_SHAPES,
  type Difficulty,
  type GameState,
  type Passenger,
  type Scenario,
  type Shape,
  type Station,
  type StationKind,
} from './types.ts';
import { Rng } from '../utils/rng.ts';
import { dist } from './geometry.ts';
import { paramsFor } from './difficulty.ts';

/** 默认剧本（未接入 AI 或离线时使用）。中性的标准难度。 */
export function defaultScenario(): Scenario {
  return {
    cityName: '通勤之城',
    description: '一座平凡的通勤都市，调度好每一列车。',
    trainSpeedMultiplier: 1,
    stationIntervalMultiplier: 1,
    events: [],
    deliverTarget: 480,
  };
}

/** 创建一份全新的游戏状态（ready 阶段）。 */
export function createInitialState(seed: number, difficulty: Difficulty = 'normal'): GameState {
  const rng = new Rng(seed);
  const stations: Station[] = [];
  let nextId = 0;
  for (let i = 0; i < INITIAL_STATIONS; i++) {
    const st = spawnStationCandidate(rng, stations);
    if (st) {
      st.id = nextId++;
      stations.push(st);
    }
  }
  const dp = paramsFor(difficulty);
  return {
    phase: 'ready',
    stations,
    lines: [],
    trains: [],
    delivered: 0,
    elapsed: 0,
    nextPassengerIn: dp.passengerInterval,
    nextStationIn: STATION_INTERVAL,
    unlockedShapes: 3, // 开局只开放前三种形状
    nextStationId: nextId,
    nextLineId: 0,
    seed,
    scenario: defaultScenario(),
    eventQueue: [],
    activeEvents: [],
    powerUps: [],
    inventory: { speed: 0, clear: 0, deliver: 0, magnet: 0, shield: 0, double: 0 },
    speedBoostTimer: 0,
    combo: { count: 0, timer: 0 },
    maxCombo: 0,
    nextPowerUpIn: POWERUP_INTERVAL,
    nextPowerUpId: 0,
    difficulty,
    capacity: dp.capacity,
    overloadGrace: dp.overloadGrace,
    passengerInterval: dp.passengerInterval,
    trainSpeed: dp.trainSpeed,
    magnetTimer: 0,
    doubleScoreTimer: 0,
  };
}

/** 取当前已解锁的形状集合。 */
export function unlockedShapes(state: GameState): readonly Shape[] {
  return ALL_SHAPES.slice(0, Math.max(1, state.unlockedShapes));
}

/** 生成一个不与现有站点过近的新站点坐标，返回构建好的 Station（或 null 表示放不下）。 */
function spawnStationCandidate(rng: Rng, existing: Station[]): Station | null {
  for (let attempt = 0; attempt < 60; attempt++) {
    const pos = {
      x: rng.range(WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN),
      y: rng.range(WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN),
    };
    const tooClose = existing.some((s) => dist(s.pos, pos) < MIN_STATION_DISTANCE);
    if (!tooClose) {
      return {
        id: -1, // 由调用方赋 id
        shape: pickStationShape(rng, existing.length + 1),
        pos,
        passengers: [],
        overloadTimer: 0,
        kind: pickStationKind(rng, existing.length),
      };
    }
  }
  return null;
}

/**
 * 选站点种类：开局前几个站点固定 normal（避免一开始就混乱）；
 * 站点变多后小概率出现 transfer / bonus 特殊站点。
 */
function pickStationKind(rng: Rng, totalStations: number): StationKind {
  if (totalStations < 5) return 'normal';
  if (!rng.chance(SPECIAL_STATION_CHANCE)) return 'normal';
  // transfer 与 bonus 各一半
  return rng.chance(0.5) ? 'transfer' : 'bonus';
}

/**
 * 给新站点选形状：前几个站点倾向用最常见的形状，
 * 站点变多后偶尔出现稀有形状，制造运送需求。
 */
function pickStationShape(rng: Rng, totalStations: number): Shape {
  // 60% 概率取前三常见形状
  const common: Shape[] = ['circle', 'triangle', 'square'];
  if (totalStations <= 6 || rng.chance(0.6)) {
    return rng.pick(common);
  }
  return rng.pick(ALL_SHAPES);
}

/** 往 state 里追加一个新站点（用于运行期定时生成）。返回是否成功。 */
export function addStation(state: GameState, rng: Rng): boolean {
  const candidate = spawnStationCandidate(rng, state.stations);
  if (!candidate) return false;
  candidate.id = state.nextStationId++;
  state.stations.push(candidate);
  return true;
}

/** 生成一名乘客：随机选一个「不同于来源站形状」的目标形状。 */
export function spawnPassenger(state: GameState, rng: Rng): Passenger {
  // 加固：站点为空时（极端初始化或测试构造）不能 pick，返回一个不挂靠任何站的占位乘客。
  // 正常游戏里站点恒非空（createInitialState 必生成 INITIAL_STATIONS）。
  const shapes = unlockedShapes(state);
  if (state.stations.length === 0 || shapes.length === 0) {
    return { target: 'circle' };
  }
  const station = rng.pick(state.stations);
  // 目标形状尽量不同于该站自身形状，避免无意义乘客
  let target = rng.pick(shapes);
  if (shapes.length > 1) {
    let guard = 0;
    while (target === station.shape && guard++ < 8) {
      target = rng.pick(shapes);
    }
  }
  const passenger: Passenger = { target };
  station.passengers.push(passenger);
  return passenger;
}
