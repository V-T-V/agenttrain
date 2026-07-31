// 游戏核心数据模型。
// 所有类型都设计成可在纯函数 simulation.ts 里被无副作用地推进，
// 不引用 DOM / Canvas，便于用 node:test 单测。

/** 站点 / 乘客的形状标识。站点形状决定它要接收哪种乘客。 */
export type Shape = 'circle' | 'triangle' | 'square' | 'diamond' | 'star';

/** 难度档：四档由易到难。 */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

/** 所有可用形状，按解锁顺序排列（难度提升时逐步引入更稀有的形状）。 */
export const ALL_SHAPES: readonly Shape[] = ['circle', 'triangle', 'square', 'diamond', 'star'];

/** 二维坐标（逻辑坐标，单位为像素）。 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 一名等待被运送的乘客。
 * `target` 是它要去的站点形状；乘客只关心终点站的形状，不关心具体哪个站。
 */
export interface Passenger {
  target: Shape;
}

/** 站点种类：normal=普通，transfer=换乘站（上车忽略可达），bonus=奖励站（送达 ×2）。 */
export type StationKind = 'normal' | 'transfer' | 'bonus';

/** 一个站点（节点）。线路通过引用 station.id 把站点串起来。 */
export interface Station {
  id: number;
  shape: Shape;
  pos: Vec2;
  /** 当前在站台上等待的乘客。超过容量且持续超载即判负。 */
  passengers: Passenger[];
  /** 累计的「过载时间」（秒）。超过 OVERLOAD_GRACE 即 Game Over。 */
  overloadTimer: number;
  /** 站点种类（默认 normal）。 */
  kind: StationKind;
}

/** 一条线路的颜色标识（同时也是 UI 颜色）。 */
export type LineColor = 'red' | 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'teal';

export const LINE_COLORS: readonly LineColor[] = [
  'red',
  'blue',
  'green',
  'orange',
  'purple',
  'pink',
  'teal',
];

/**
 * 一条线路：由一组有序的站点 id 序列定义。
 * 站点数 >= 2 才合法。线路可继续在两端延伸。
 */
export interface Line {
  id: number;
  color: LineColor;
  /** 有序站点 id。stops[0] 与 stops[last] 为线路的两个端点。 */
  stops: number[];
}

/** 一列在线路上运行的列车。 */
export interface Train {
  /** 所属线路 id。 */
  lineId: number;
  /**
   * 沿线路的弧长进度，单位：段索引 + [0,1) 的段内比例。
   * segment 指向 line.stops[segment] → line.stops[segment+1] 这一段。
   * direction = 1 表示沿 stops 序列正方向前进，-1 表示反方向。
   */
  segment: number;
  /** 段内进度 [0,1)。 */
  t: number;
  direction: 1 | -1;
  /** 列车上正在搭乘的乘客。 */
  passengers: Passenger[];
  /** 在站点停靠时累积的停留计时器（秒）；到上限则重新发车。 */
  dwellTimer: number;
}

/** 游戏运行阶段。 */
export type GamePhase = 'ready' | 'running' | 'paused' | 'gameover';

/** 完整游戏状态。simulation.ts 的纯函数以此为输入/输出。 */
export interface GameState {
  phase: GamePhase;
  stations: Station[];
  lines: Line[];
  trains: Train[];
  /** 成功送达的乘客数（分数）。 */
  delivered: number;
  /** 已经过的游戏时间（秒）。 */
  elapsed: number;
  /** 距离下一次生成新乘客的倒计时（秒）。 */
  nextPassengerIn: number;
  /** 距离下一次生成新站点的倒计时（秒）。 */
  nextStationIn: number;
  /** 当前已解锁的形状种类数（随时间增加）。 */
  unlockedShapes: number;
  /** 下一个可分配的站点 id。 */
  nextStationId: number;
  /** 下一个可分配的线路 id。 */
  nextLineId: number;
  /** 随机数发生器种子（仅用于复现/调试展示，实际随机由 Rng 实例驱动）。 */
  seed: number;
  /** AI 生成的剧本（无 AI 时为默认剧本）。 */
  scenario: Scenario;
  /** 剧本事件队列（按 at 时间触发）。 */
  eventQueue: ScriptedEvent[];
  /** 当前生效的临时事件（如罢工/减速），用于渲染提示与逻辑判定。 */
  activeEvents: ActiveEvent[];
  /** 地图上待拾取的道具。 */
  powerUps: PowerUp[];
  /** 玩家背包：每种道具的持有数量。 */
  inventory: Record<PowerUpType, number>;
  /** 当前生效的「加速」道具计时（秒），>0 时列车 2 倍速。 */
  speedBoostTimer: number;
  /** 连击状态（短时连续送达累加倍率）。 */
  combo: Combo;
  /** 本局达到过的最高连击数（结束战绩用）。 */
  maxCombo: number;
  /** 道具生成倒计时（运行期内部用，不渲染）。 */
  nextPowerUpIn: number;
  /** 下一个可分配的道具 id。 */
  nextPowerUpId: number;
  /** 当前难度档（决定下面的各参数）。 */
  difficulty: Difficulty;
  /** 站点最大乘客数（由难度档注入）。 */
  capacity: number;
  /** 满载后宽限秒数（由难度档注入）。 */
  overloadGrace: number;
  /** 乘客生成基础间隔秒数（由难度档注入）。 */
  passengerInterval: number;
  /** 列车速度段/秒（由难度档注入）。 */
  trainSpeed: number;
  /** 磁铁道具剩余生效时间（秒）；>0 时列车上车忽略可达检查。 */
  magnetTimer: number;
  /** 双倍得分道具剩余生效时间（秒）；>0 时送达得分 ×2。 */
  doubleScoreTimer: number;
}

/** 道具类型。 */
export type PowerUpType = 'speed' | 'clear' | 'deliver' | 'magnet' | 'shield' | 'double';

/** 地图上的一个可拾取道具。 */
export interface PowerUp {
  id: number;
  type: PowerUpType;
  pos: Vec2;
}

/** 连击状态。 */
export interface Combo {
  /** 当前连击数。 */
  count: number;
  /** 剩余维持时间（秒）；归零则连击清零。 */
  timer: number;
}

/** 剧本：由 AI 生成的整局参数包。 */
export interface Scenario {
  /** 城市名 / 剧本标题。 */
  cityName: string;
  /** 一句话描述（渲染时显示）。 */
  description: string;
  /** 列车速度倍率（1 = 正常）。<1 = 更难。 */
  trainSpeedMultiplier: number;
  /** 新站点生成间隔倍率（1 = 正常）。<1 = 站点更密。 */
  stationIntervalMultiplier: number;
  /** 剧本事件（按游戏内 at 秒触发）。 */
  events: ScriptedEvent[];
  /** 本局送达目标（达成即视为「胜利」，但游戏可继续）。 */
  deliverTarget: number;
}

/** 剧本里的一个事件定义。 */
export interface ScriptedEvent {
  /** 触发时间（游戏内秒）。 */
  at: number;
  /** 事件类型：strike=某形状站点停运, slow=列车减速, surge=乘客涌现。 */
  kind: 'strike' | 'slow' | 'surge';
  /** 受影响的站点形状（strike/surge 用）。 */
  stationShape?: Shape;
  /** 持续时间（秒）。 */
  duration: number;
}

/** 运行期中「当前生效」的事件实例。 */
export interface ActiveEvent {
  kind: ScriptedEvent['kind'];
  stationShape?: Shape;
  /** 剩余持续时间（秒），归零即移除。 */
  remaining: number;
}
