// 游戏可调常量。集中放这里，便于平衡性调整和测试覆盖。
// 这些是「纯逻辑」常量，simulation.ts 直接引用；渲染相关尺寸见 render.ts。

/** 单个站点能容纳的最大乘客数。 */
export const STATION_CAPACITY = 6;

/** 站点过载（满载）后允许的宽限时间（秒），超过即判负。 */
export const OVERLOAD_GRACE = 6;

/** 列车运行速度，单位：段/秒（一段 = 两站之间的距离）。 */
export const TRAIN_SPEED = 0.45;

/** 列车到站后的停留时间（秒），用于装卸乘客。 */
export const TRAIN_DWELL = 0.35;

/** 列车单次最多搭载的乘客数。 */
export const TRAIN_CAPACITY = 6;

/** 初始站点数量。 */
export const INITIAL_STATIONS = 4;

/** 玩家最多可建立的线路数。 */
export const MAX_LINES = 7;

/** 一条线路最少需要的站点数（含两端）。 */
export const MIN_LINE_STOPS = 2;

/** 新乘客的基础生成间隔（秒）。 */
export const PASSENGER_INTERVAL = 5.5;

/** 新乘客生成间隔随时间线性缩短的下限（秒）。 */
export const PASSENGER_INTERVAL_MIN = 2.0;

/** 乘客生成间隔的缩减速率（秒 / 每游戏分钟）。 */
export const PASSENGER_INTERVAL_DECAY_PER_MIN = 0.8;

/** 新站点生成间隔（秒）。 */
export const STATION_INTERVAL = 22;

/** 每经过多少秒解锁一个新形状（直到用满 ALL_SHAPES 全部）。 */
export const SHAPE_UNLOCK_INTERVAL = 30;

/** 画布逻辑尺寸（渲染与命中检测都以这个坐标系为准）。 */
export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 600;

/** 站点在画布上的命中/绘制半径（像素）。 */
export const STATION_RADIUS = 16;

/** 新站点之间允许的最小间距（像素），避免叠在一起。 */
export const MIN_STATION_DISTANCE = 110;

/** 两站之间要建线路/合并站点时的吸附半径（像素）。 */
export const SNAP_DISTANCE = 26;

/** 固定逻辑步长（秒）。主循环按此步长推进 simulation，保证帧率无关。 */
export const FIXED_STEP = 1 / 60;

/** 画布四周留白，避免站点贴边。 */
export const WORLD_MARGIN = 60;

// ===== 道具系统 =====

/** 道具生成间隔（秒）。 */
export const POWERUP_INTERVAL = 25;

/** 地图上同时存在的道具上限。 */
export const MAX_POWERUPS = 3;

/** 道具在地图上的命中/绘制半径（像素）。 */
export const POWERUP_RADIUS = 14;

/** 「加速」道具的持续时间（秒）。 */
export const SPEED_BOOST_DURATION = 8;

/** 加速期间列车速度倍率。 */
export const SPEED_BOOST_MULTIPLIER = 2;

/** 背包每种道具的堆叠上限。 */
export const MAX_INVENTORY = 3;

// ===== 连击系统 =====

/** 每次送达后维持连击的时间窗口（秒）。 */
export const COMBO_WINDOW = 3.0;

/** 每多少次连击提升一档倍率。 */
export const COMBO_STEP = 5;

/** 每档倍率增量（每 COMBO_STEP 次连击 +0.5 倍）。 */
export const COMBO_MULTIPLIER_STEP = 0.5;
