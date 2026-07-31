// 模拟核心：纯函数式地把 GameState 往前推进 dt 秒。
// 这是整个游戏「逻辑」的入口，render.ts 只读 GameState，input.ts 只改 lines/trains 结构。
// 这里不 import DOM，便于 node:test 单测。

import {
  ALL_SHAPES,
  type GameState,
  type Line,
  type LineColor,
  type Station,
  type Train,
  type Vec2,
} from './types.ts';
import {
  MAX_LINES,
  PASSENGER_INTERVAL_DECAY_PER_MIN,
  PASSENGER_INTERVAL_MIN,
  SHAPE_UNLOCK_INTERVAL,
  TRAIN_CAPACITY,
  TRAIN_DWELL,
} from './config.ts';
import { addStation, spawnPassenger } from './state.ts';
import { positionAlong, segmentLength } from './geometry.ts';
import { isEventActive } from './eventRegistry.ts';
import { pumpEvents, tickActiveEvents } from './events.ts';
import {
  isMagnetActive,
  maybeSpawnPowerUp,
  pickupPowerUps,
  registerComboHit,
  scoreMultiplier,
  speedBoostMultiplier,
  tickCombo,
  tickDoubleScore,
  tickMagnet,
  tickSpeedBoost,
} from './powerups.ts';
import type { Rng } from '../utils/rng.ts';

/**
 * 推进游戏状态 dt 秒。原地修改 state（为性能，并简化调用方），
 * 返回同一个 state 引用，便于链式书写。
 *
 * 当 phase != 'running' 时直接返回（不推进）。
 * 检测到站点持续过载会把 phase 置为 'gameover'。
 */
export function step(state: GameState, dt: number, rng: Rng): GameState {
  if (state.phase !== 'running') return state;
  if (dt <= 0) return state;

  state.elapsed += dt;

  // 剧本事件：到点的转 active，已 active 的衰减
  pumpEvents(state.elapsed, state.eventQueue, state.activeEvents);
  tickActiveEvents(state.activeEvents, dt);

  // 道具：定时生成、列车拾取、加速/磁铁/双倍/连击计时器衰减
  maybeSpawnPowerUp(state, dt, rng);
  pickupPowerUps(state);
  tickSpeedBoost(state, dt);
  tickMagnet(state, dt);
  tickDoubleScore(state, dt);
  tickCombo(state, dt);

  spawnTimers(state, dt, rng);
  moveTrains(state, dt);
  handleOverload(state, dt);
  maybeUnlockShapes(state);

  return state;
}

// ---------- 生成：定时产生乘客与站点 ----------

/** 处理乘客/站点的生成倒计时与形状解锁节奏。 */
function spawnTimers(state: GameState, dt: number, rng: Rng): void {
  // 乘客生成间隔随游戏时长缩短（越来越紧张），基础间隔由难度档决定
  const minutes = state.elapsed / 60;
  const interval = Math.max(
    PASSENGER_INTERVAL_MIN,
    state.passengerInterval - PASSENGER_INTERVAL_DECAY_PER_MIN * minutes,
  );

  state.nextPassengerIn -= dt;
  while (state.nextPassengerIn <= 0) {
    state.nextPassengerIn += interval;
    spawnPassenger(state, rng);
    // 「高峰」事件期间额外多刷一名乘客
    if (isEventActive(state.activeEvents, 'surge')) spawnPassenger(state, rng);
  }

  state.nextStationIn -= dt;
  if (state.nextStationIn <= 0) {
    state.nextStationIn += stationIntervalNow(state);
    addStation(state, rng);
  }
}

/** 当前的新站点生成间隔（站点越多越快出现），叠加剧本倍率。 */
function stationIntervalNow(state: GameState): number {
  // 基础 22s，每多 5 个站缩短 2s，下限 8s
  const extra = Math.floor(state.stations.length / 5);
  const base = Math.max(8, 22 - extra * 2);
  return base * state.scenario.stationIntervalMultiplier;
}

/** 每隔固定时间解锁一种新形状（直到用满 ALL_SHAPES）。 */
function maybeUnlockShapes(state: GameState): void {
  const target = Math.min(ALL_SHAPES.length, 3 + Math.floor(state.elapsed / SHAPE_UNLOCK_INTERVAL));
  if (target > state.unlockedShapes) state.unlockedShapes = target;
}

// ---------- 列车运动 ----------

/** 推进所有列车沿其线路运行，到站时装卸乘客。 */
function moveTrains(state: GameState, dt: number): void {
  for (const train of state.trains) {
    const line = state.lines.find((l) => l.id === train.lineId);
    if (!line || line.stops.length < 2) continue;
    advanceTrain(state, train, line, dt);
  }
}

/**
 * 把单列列车推进 dt 秒：
 * - 若在停靠（dwellTimer>0），先消耗停留时间；
 * - 否则沿当前段前进，到段终点（站点）则停靠并触发装卸。
 */
function advanceTrain(state: GameState, train: Train, line: Line, dt: number): void {
  const points = linePoints(state, line);

  // 把「本帧仍需消耗的剩余时间」放进来统一推进。
  // 进入函数前若处于停靠中，先把已积累的 dwellTimer 计入剩余时间，
  // 这样无论 dt 多大（测试里常见整段大步长），列车都能在一次 step 内
  // 完成多次「前进 → 到站 → 停留 → 再前进」。
  let remaining = dt;
  if (train.dwellTimer > 0) {
    remaining += train.dwellTimer;
    train.dwellTimer = 0;
  }

  // 安全上限，防止极端 dt / 极短段导致的死循环
  let safety = 512;
  while (remaining > 0 && safety-- > 0) {
    // 若正处于停留，先消耗停留时间
    if (train.dwellTimer > 0) {
      if (train.dwellTimer >= remaining) {
        train.dwellTimer -= remaining;
        remaining = 0;
        break;
      }
      remaining -= train.dwellTimer;
      train.dwellTimer = 0;
    }

    const segLen = segmentLength(points, train.segment);
    if (segLen <= 0) {
      // 退化段（同坐标），直接到下一站
      arriveAtStation(state, train, line);
      continue;
    }
    // 速度归一化到「每秒走过的像素」，trainSpeed 由难度档决定（段/秒），乘以段长得像素/秒。
    // 叠加剧本速度倍率、加速道具、减速事件（三者相乘）。
    const slowFactor = isEventActive(state.activeEvents, 'slow') ? 0.5 : 1;
    const speedPx =
      state.trainSpeed *
      state.scenario.trainSpeedMultiplier *
      speedBoostMultiplier(state) *
      slowFactor *
      segLen;
    const progress = speedPx * remaining; // 这一帧能走的像素
    const tAdd = progress / segLen;

    if (train.t + tAdd < 1) {
      train.t += tAdd;
      remaining = 0;
    } else {
      // 走完本段，抵达站点
      const overshootPx = (1 - train.t) * segLen;
      remaining -= overshootPx / speedPx;
      train.t = 0;
      arriveAtStation(state, train, line);
      // arriveAtStation 已设置 dwellTimer，下一轮循环会先消耗停留时间
    }
  }
}

/**
 * 列车抵达当前段终点站后的处理：转向、装卸乘客、设置停留计时。
 * 抵达后 segment/direction 指向「下一待出发段」。
 */
function arriveAtStation(state: GameState, train: Train, line: Line): void {
  const points = linePoints(state, line);
  const lastSeg = points.length - 2;

  // 先确定抵达的是哪个站点 id
  let arrivedStopIdx: number;
  if (train.direction === 1) {
    arrivedStopIdx = train.segment + 1;
  } else {
    arrivedStopIdx = train.segment;
  }
  const stationId = line.stops[arrivedStopIdx];
  const station =
    stationId !== undefined ? state.stations.find((s) => s.id === stationId) : undefined;

  // 装卸（无论是否换向都先在站处理）
  if (station) {
    exchangePassengers(state, train, station);
  }

  // 决定下一段：到端点则换向
  if (train.direction === 1 && train.segment >= lastSeg) {
    train.direction = -1;
    train.segment = lastSeg;
  } else if (train.direction === -1 && train.segment <= 0) {
    train.direction = 1;
    train.segment = 0;
  } else {
    train.segment += train.direction;
  }
  train.t = 0;
  train.dwellTimer = TRAIN_DWELL;
}

/**
 * 列车在站点装卸乘客：
 * - 先下车：车上乘客若目标是该站形状，则送达（delivered++）；
 * - 再上车：把站台上去往「本线路能到达的某些形状」的乘客接上车（直到满载）。
 */
function exchangePassengers(state: GameState, train: Train, station: Station): void {
  // 罢工中的站点：列车经过但不装卸（停运）
  if (isEventActive(state.activeEvents, 'strike', station.shape)) return;

  // 奖励站送达额外 ×2（与连击/双倍道具叠加）
  const bonusMultiplier = station.kind === 'bonus' ? 2 : 1;
  // 下车：每送达一名，按当前得分倍率（连击 × 双倍道具 × 奖励站）加分并刷新连击窗口
  const staying: typeof train.passengers = [];
  const mult = scoreMultiplier(state) * bonusMultiplier;
  for (const p of train.passengers) {
    if (p.target === station.shape) {
      state.delivered += mult;
      registerComboHit(state);
    } else {
      staying.push(p);
    }
  }
  train.passengers = staying;

  // 上车：磁铁道具生效 或 换乘站 时，忽略「目标形状可达」检查（任意乘客可上车）
  const skipReachable = isMagnetActive(state) || station.kind === 'transfer';
  const line = state.lines.find((l) => l.id === train.lineId);
  if (!line) return;
  const reachableShapes = reachableShapeSet(state, line);

  const stillWaiting: typeof station.passengers = [];
  for (const p of station.passengers) {
    const canBoard = skipReachable || reachableShapes.has(p.target);
    if (train.passengers.length < TRAIN_CAPACITY && canBoard) {
      train.passengers.push(p);
    } else {
      stillWaiting.push(p);
    }
  }
  station.passengers = stillWaiting;
}

/** 一条线路能够送达的所有形状（线路上所有站点的形状并集，用于上车决策）。 */
function reachableShapeSet(state: GameState, line: Line): Set<string> {
  const set = new Set<string>();
  for (const sid of line.stops) {
    const st = state.stations.find((s) => s.id === sid);
    if (st) set.add(st.shape);
  }
  return set;
}

// ---------- 过载判定（失败条件） ----------

/** 站点满载时累积 overloadTimer，超过宽限时间即 Game Over。 */
function handleOverload(state: GameState, dt: number): void {
  for (const st of state.stations) {
    if (st.passengers.length >= state.capacity) {
      st.overloadTimer += dt;
      if (st.overloadTimer >= state.overloadGrace) {
        state.phase = 'gameover';
        return;
      }
    } else {
      st.overloadTimer = 0;
    }
  }
}

// ---------- 线路 / 列车 结构操作（被 input.ts 调用） ----------

/**
 * 新建一条线路：从 startStation 拖到 endStation。
 * 自动分配颜色与一列列车。返回是否成功。
 * 失败原因：已达线路数上限 / 两站相同 / 站点不存在。
 */
export function createLine(
  state: GameState,
  startStationId: number,
  endStationId: number,
): boolean {
  if (startStationId === endStationId) return false;
  if (state.lines.length >= MAX_LINES) return false;
  const start = state.stations.find((s) => s.id === startStationId);
  const end = state.stations.find((s) => s.id === endStationId);
  if (!start || !end) return false;

  const usedColors = new Set(state.lines.map((l) => l.color));
  const color: LineColor = pickColor(usedColors);
  const line: Line = {
    id: state.nextLineId++,
    color,
    stops: [startStationId, endStationId],
  };
  state.lines.push(line);

  // 每条新线路配一列车，从第 0 段正方向出发
  state.trains.push({
    lineId: line.id,
    segment: 0,
    t: 0,
    direction: 1,
    passengers: [],
    dwellTimer: TRAIN_DWELL,
  });
  return true;
}

/**
 * 在已有线路的端点上追加一个站点。
 * @param atStart true=把新站加到线路头部，false=加到尾部。
 */
export function extendLine(
  state: GameState,
  lineId: number,
  newStationId: number,
  atStart: boolean,
): boolean {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return false;
  if (line.stops.includes(newStationId)) return false;
  const station = state.stations.find((s) => s.id === newStationId);
  if (!station) return false;

  if (atStart) {
    line.stops.unshift(newStationId);
    // 段索引整体 +1（因为前面插入了一段）。
    // 同时需调整 t：新段长度与原第 0 段长度不同时，列车在原段内的进度 t 需按段长度比例缩放，
    // 否则列车会跳到新段的错误位置。修复：t 按新段长度重映射。
    for (const tr of trainsOn(state, lineId)) {
      const oldSegLength = segmentLength(linePoints(state, line), tr.segment);
      tr.segment += 1;
      const newSegLength = segmentLength(linePoints(state, line), tr.segment);
      if (oldSegLength > 0 && newSegLength > 0) {
        // 把原段内进度按段长度比例转换（保持列车在世界空间的视觉位置不变）
        tr.t = Math.min(0.999, (tr.t * oldSegLength) / newSegLength);
      }
    }
  } else {
    line.stops.push(newStationId);
  }
  return true;
}

/** 删除一条线路（及其列车）。 */
export function removeLine(state: GameState, lineId: number): void {
  state.lines = state.lines.filter((l) => l.id !== lineId);
  state.trains = state.trains.filter((t) => t.lineId !== lineId);
}

/** 找出线路端点站（用于拖拽吸附判断）。 */
export function lineEndpoints(state: GameState, lineId: number): { head?: number; tail?: number } {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line || line.stops.length === 0) return {};
  return {
    head: line.stops[0],
    tail: line.stops[line.stops.length - 1],
  };
}

// ---------- 辅助 ----------

function trainsOn(state: GameState, lineId: number): Train[] {
  return state.trains.filter((t) => t.lineId === lineId);
}

/** 线路颜色分配顺序（7 色）。MAX_LINES(24) > 7，超过会复用。 */
export const LINE_COLOR_ORDER: readonly LineColor[] = [
  'red',
  'blue',
  'green',
  'orange',
  'purple',
  'pink',
  'teal',
];

/** 选一个尚未被使用的线路颜色；全用完则回退首色（复用）。 */
export function pickColor(used: Set<LineColor>): LineColor {
  for (const c of LINE_COLOR_ORDER) {
    if (!used.has(c)) return c;
  }
  // MAX_LINES(24) > 7 色：超过 7 条线后会复用颜色。同色视觉混淆是已知限制。
  return LINE_COLOR_ORDER[0]!;
}

/** 构建 station id → Station 的索引 Map，消除重复的 O(n) find 扫描。 */
export function stationIndex(state: GameState): Map<number, Station> {
  const m = new Map<number, Station>();
  for (const s of state.stations) m.set(s.id, s);
  return m;
}

/** 把线路的 stops 映射成坐标点序列（渲染与定位都用它）。 */
export function linePoints(state: GameState, line: Line): Vec2[] {
  // 站点数较多时，先建一次 Map 索引（O(n)）再 O(1) 查找，优于每站 find。
  // 站点 ≤4 时直接 find 更省一次 Map 构建。
  if (state.stations.length <= 4) {
    const pts: Vec2[] = [];
    for (const sid of line.stops) {
      const st = state.stations.find((s) => s.id === sid);
      if (st) pts.push({ x: st.pos.x, y: st.pos.y });
    }
    return pts;
  }
  const idx = stationIndex(state);
  const pts: Vec2[] = [];
  for (const sid of line.stops) {
    const st = idx.get(sid);
    if (st) pts.push({ x: st.pos.x, y: st.pos.y });
  }
  return pts;
}

/** 计算一列列车当前世界坐标（供渲染使用）。 */
export function trainPosition(state: GameState, train: Train): Vec2 {
  const line = state.lines.find((l) => l.id === train.lineId);
  if (!line) return { x: 0, y: 0 };
  const points = linePoints(state, line);
  return positionAlong(points, train.segment, train.t);
}
