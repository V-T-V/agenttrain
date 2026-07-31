// Canvas 渲染层。只读 GameState，不修改它。
// 负责把站点、线路、列车、乘客计数、HUD 和结束遮罩画到画布上。

import {
  COMBO_MULTIPLIER_STEP,
  COMBO_STEP,
  COMBO_WINDOW,
  MAX_LINES,
  STATION_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './game/config.ts';
import type {
  Difficulty,
  GameState,
  LineColor,
  Shape,
  Station,
  Train,
  Vec2,
} from './game/types.ts';
import { linePoints, trainPosition } from './game/simulation.ts';
import { lerpVec2 } from './game/geometry.ts';
import { describeActive } from './game/events.ts';
import { ALL_DIFFICULTIES, DIFFICULTY_NAME } from './game/difficulty.ts';
import type { HighScores } from './game/highscore.ts';
import { POWERUP_EMOJI } from './game/powerups.ts';
import { getAchievement } from './game/achievements.ts';
import type { Camera } from './game/camera.ts';
import { type TutorialStep, TUTORIAL_TEXT, pauseMenuLayout } from './game/tutorial.ts';
import type { Advice } from './ai/advisor.ts';

/** 线路颜色 → CSS 颜色。 */
const LINE_CSS: Record<LineColor, string> = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#27ae60',
  orange: '#e67e22',
  purple: '#9b59b6',
  pink: '#e84393',
  teal: '#16a085',
};

export interface RenderOptions {
  /** 当前拖拽中的预览：从某站拖到当前鼠标位置的临时线段。 */
  dragPreview?: {
    color: LineColor;
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null;
  /** 策略顾问当前建议（底部气泡）。 */
  advice?: Advice | null;
  /** AI 模式：手动 / 自动。 */
  aiMode?: 'manual' | 'auto';
  /** AI 状态文案（HUD 右下）。 */
  aiStatus?: string;
  /**
   * 固定步长累加器的插值因子 alpha = accumulator / FIXED_STEP，∈[0,1)。
   * 渲染时用它在「上一帧逻辑位置」与「当前逻辑位置」间线性插值，
   * 让列车在 >60Hz 屏幕上平滑移动而非阶梯式抖动。省略时退化为不插值。
   */
  alpha?: number;
  /** 各档历史最高分（ready 面板展示）。 */
  bestScores?: HighScores;
  /** 本局是否破纪录（gameover 面板展示）。 */
  newRecord?: boolean;
  /** 当前教程步骤（0=不在教程态，1-4=四步引导）。 */
  tutorialStep?: TutorialStep;
  /** 摄像机（缩放/平移）；世界层据此变换，HUD/遮罩用视口坐标不受影响。 */
  camera?: Camera;
  /** 本局新解锁的成就 id 列表（gameover 面板展示）。 */
  newlyUnlocked?: string[];
}

/** 主绘制入口。
 *  width/height 是「显示视口」尺寸；camera 决定看到世界的哪一块。
 *  世界层（线路/列车/站点/道具）受 camera 变换；HUD/遮罩用视口坐标。 */
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  options: RenderOptions = {},
): void {
  clearBackground(ctx, width, height);
  // 世界层：套 camera 变换
  const cam = options.camera ?? { x: 0, y: 0, zoom: 1 };
  // 计算摄像机可见的世界范围（用于视口剔除，跳过屏外绘制）
  const viewBounds = {
    minX: cam.x - 50,
    minY: cam.y - 50,
    maxX: cam.x + width / cam.zoom + 50,
    maxY: cam.y + height / cam.zoom + 50,
  };
  ctx.save();
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  drawWorld(ctx, state, options, viewBounds);
  ctx.restore();
  // 视口层（HUD/背包/迷你地图/气泡/遮罩）：视口坐标，不受 camera 影响
  drawHud(ctx, state, width, height, options);
  drawInventory(ctx, state, width, height);
  drawMinimap(ctx, state, width, height, cam);
  drawAdviceBubble(ctx, options.advice, width, height);
  drawOverlay(ctx, state, width, height, options, cam);
}

/** 迷你地图：左下角小窗，显示整个世界 + 站点 + 当前摄像机视口框。 */
function drawMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  cam: Camera,
): void {
  const mw = 140;
  const mh = mw * (WORLD_HEIGHT / WORLD_WIDTH); // 保持世界宽高比
  const mx = 16;
  const my = height - mh - 16;
  const sx = mw / WORLD_WIDTH; // 世界→迷你地图缩放
  const sy = mh / WORLD_HEIGHT;

  ctx.save();
  // 背景
  ctx.fillStyle = 'rgba(44,62,80,0.7)';
  ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = 'rgba(241,196,15,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mw, mh);

  // 站点
  for (const s of state.stations) {
    ctx.fillStyle = s.kind === 'bonus' ? '#9b59b6' : s.kind === 'transfer' ? '#1abc9c' : '#ecf0f1';
    ctx.beginPath();
    ctx.arc(mx + s.pos.x * sx, my + s.pos.y * sy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 线路
  ctx.lineWidth = 0.8;
  for (const line of state.lines) {
    const pts = linePoints(state, line);
    if (pts.length < 2) continue;
    ctx.strokeStyle = LINE_CSS[line.color];
    ctx.beginPath();
    ctx.moveTo(mx + pts[0]!.x * sx, my + pts[0]!.y * sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(mx + pts[i]!.x * sx, my + pts[i]!.y * sy);
    ctx.stroke();
  }
  // 摄像机视口框
  const viewW = width / cam.zoom;
  const viewH = height / cam.zoom;
  ctx.strokeStyle = 'rgba(241,196,15,0.9)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mx + cam.x * sx, my + cam.y * sy, viewW * sx, viewH * sy);
  ctx.restore();
}

/** 世界层绘制：线路/拖拽预览/道具/列车/站点（全部世界坐标，带视口剔除）。 */
function drawWorld(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  options: RenderOptions,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  drawLines(ctx, state, bounds);
  drawDragPreview(ctx, options);
  drawPowerUps(ctx, state, bounds);
  drawTrains(ctx, state, options.alpha, bounds);
  drawStations(ctx, state, bounds);
}

function clearBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, w, h);
}

// ---------- 线路 ----------

function drawLines(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  for (const line of state.lines) {
    const pts = linePoints(state, line);
    if (pts.length < 2) continue;
    // 视口剔除：线路上所有点都在视口外则跳过
    const anyVisible = pts.some(
      (p) => p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY,
    );
    if (!anyVisible) continue;
    ctx.strokeStyle = LINE_CSS[line.color];
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i]!.x, pts[i]!.y);
    }
    ctx.stroke();
  }
}

function drawDragPreview(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const d = options.dragPreview;
  if (!d) return;
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 6;
  ctx.strokeStyle = LINE_CSS[d.color] ?? '#888';
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(d.from.x, d.from.y);
  ctx.lineTo(d.to.x, d.to.y);
  ctx.stroke();
  ctx.restore();
}

// ---------- 道具 ----------

function drawPowerUps(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  for (const pu of state.powerUps) {
    // 视口剔除
    if (
      pu.pos.x < bounds.minX ||
      pu.pos.x > bounds.maxX ||
      pu.pos.y < bounds.minY ||
      pu.pos.y > bounds.maxY
    )
      continue;
    ctx.save();
    // 光晕
    const grad = ctx.createRadialGradient(pu.pos.x, pu.pos.y, 2, pu.pos.x, pu.pos.y, 20);
    grad.addColorStop(0, 'rgba(241,196,15,0.5)');
    grad.addColorStop(1, 'rgba(241,196,15,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pu.pos.x, pu.pos.y, 20, 0, Math.PI * 2);
    ctx.fill();
    // 底圈
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pu.pos.x, pu.pos.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // emoji
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_EMOJI[pu.type], pu.pos.x, pu.pos.y + 1);
    ctx.restore();
  }
}

/** 右下背包栏 + 连击显示。 */
function drawInventory(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
): void {
  const slots: Array<{
    key: string;
    type: 'speed' | 'clear' | 'deliver' | 'magnet' | 'shield' | 'double';
  }> = [
    { key: '1', type: 'speed' },
    { key: '2', type: 'clear' },
    { key: '3', type: 'deliver' },
    { key: '4', type: 'magnet' },
    { key: '5', type: 'shield' },
    { key: '6', type: 'double' },
  ];
  const boxW = 192;
  const boxH = 30;
  const x = width - boxW - 16;
  const y = height - boxH - 16;

  ctx.save();
  // 连击
  if (state.combo.count >= 2) {
    ctx.fillStyle = '#e67e22';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const mult = 1 + Math.floor(state.combo.count / COMBO_STEP) * COMBO_MULTIPLIER_STEP;
    ctx.fillText(`🔥 连击 x${state.combo.count} (${mult}倍)`, 16, height - 28);
    // 连击剩余时间条
    const ratio = Math.max(0, state.combo.timer / COMBO_WINDOW);
    ctx.fillStyle = 'rgba(230,126,34,0.3)';
    ctx.fillRect(16, height - 16, 120, 4);
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(16, height - 16, 120 * ratio, 4);
  }

  // 背包三个槽
  slots.forEach((slot, i) => {
    const sx = x + i * 32;
    const count = state.inventory[slot.type] ?? 0;
    ctx.fillStyle = count > 0 ? '#fff' : '#ecf0f1';
    ctx.strokeStyle = count > 0 ? '#f39c12' : '#bdc3c7';
    ctx.lineWidth = 1.5;
    roundRect(ctx, sx, y, 28, 28, 5);
    ctx.fill();
    ctx.stroke();
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = count > 0 ? 1 : 0.4;
    ctx.fillText(POWERUP_EMOJI[slot.type], sx + 9, y + 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(slot.key, sx + 22, y + 7);
    if (count > 0) {
      ctx.fillStyle = '#e67e22';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(String(count), sx + 22, y + 21);
    }
  });
  ctx.restore();
}

// ---------- 列车 ----------

/**
 * 上一帧每列车的渲染位置缓存（按 lineId 索引，每条线至多一列车）。
 * 用于帧间线性插值，消除 >60Hz 屏幕上列车阶梯式抖动。
 * 模块级而非每帧重建：跨 render() 调用保持上一帧状态。
 */
const prevTrainPositions = new WeakMap<Train, Vec2>();

function drawTrains(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  alpha: number | undefined,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  for (const train of state.trains) {
    const line = state.lines.find((l) => l.id === train.lineId);
    if (!line) continue;

    const curr = trainPosition(state, train);
    // 停靠中（dwellTimer>0）位置不变，无需插值；否则在 prev→curr 间 lerp。
    // 以 train 对象为键（而非 lineId）：支持未来一线多车，WeakMap 还能自动 GC。
    const prev = prevTrainPositions.get(train);
    const pos =
      alpha !== undefined && prev !== undefined && train.dwellTimer <= 0
        ? lerpVec2(prev, curr, alpha)
        : curr;
    prevTrainPositions.set(train, curr);
    // 视口剔除：跳过屏外列车
    if (pos.x < bounds.minX || pos.x > bounds.maxX || pos.y < bounds.minY || pos.y > bounds.maxY)
      continue;
    const color = LINE_CSS[line.color];

    // 车身
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = '#2c3e50';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    roundRect(ctx, -14, -8, 28, 16, 4);
    ctx.fill();
    ctx.stroke();

    // 车上乘客数量小点
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(train.passengers.length), 0, 0);
    ctx.restore();
  }
  // WeakMap 自动 GC 已销毁列车的缓存，无需手动清理。
}

// ---------- 站点 ----------

function drawStations(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  for (const station of state.stations) {
    // 视口剔除：跳过屏外站点
    if (
      station.pos.x < bounds.minX ||
      station.pos.x > bounds.maxX ||
      station.pos.y < bounds.minY ||
      station.pos.y > bounds.maxY
    )
      continue;
    drawStation(ctx, station);
    drawPassengerBadges(ctx, station);
    drawOverloadRing(ctx, station, state.capacity, state.overloadGrace);
  }
}

function drawStation(ctx: CanvasRenderingContext2D, station: Station): void {
  ctx.save();
  ctx.translate(station.pos.x, station.pos.y);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#2c3e50';
  ctx.lineWidth = 3;
  drawShape(ctx, station.shape, STATION_RADIUS);
  ctx.fill();
  ctx.stroke();
  // 特殊站点角标（换乘站 🔀 / 奖励站 💎）
  if (station.kind === 'transfer' || station.kind === 'bonus') {
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      station.kind === 'transfer' ? '🔀' : '💎',
      STATION_RADIUS - 2,
      -STATION_RADIUS + 2,
    );
  }
  ctx.restore();
}

/** 站点周围的小乘客形状指示（最多画 6 个，超出用数字）。 */
function drawPassengerBadges(ctx: CanvasRenderingContext2D, station: Station): void {
  const count = station.passengers.length;
  if (count === 0) return;

  // 站点右上角聚合显示：一个小方块 + 数字，简洁清晰
  const bx = station.pos.x + STATION_RADIUS + 2;
  const by = station.pos.y - STATION_RADIUS - 2;
  ctx.save();
  ctx.fillStyle = '#2c3e50';
  roundRect(ctx, bx - 9, by - 9, 18, 18, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), bx, by);

  // 若接近满载，画上目标形状小点提示
  const maxPreview = Math.min(count, 3);
  for (let i = 0; i < maxPreview; i++) {
    const p = station.passengers[i]!;
    ctx.fillStyle = '#2c3e50';
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 1.5;
    const px = station.pos.x - STATION_RADIUS - 6;
    const py = station.pos.y - STATION_RADIUS - 6 + i * 9;
    drawShape(ctx, p.target, 3.5, px, py);
  }
  ctx.restore();
}

/** 站点过载时画一个红色警告环，半径随过载时间膨胀。
 *  capacity/overloadGrace 由难度档决定，不能硬编码。 */
function drawOverloadRing(
  ctx: CanvasRenderingContext2D,
  station: Station,
  capacity: number,
  overloadGrace: number,
): void {
  if (station.passengers.length < capacity) return;
  const t = Math.min(1, station.overloadTimer / overloadGrace);
  ctx.save();
  ctx.strokeStyle = `rgba(231,76,60,${0.4 + 0.5 * t})`;
  ctx.lineWidth = 3 + 2 * t;
  ctx.beginPath();
  ctx.arc(station.pos.x, station.pos.y, STATION_RADIUS + 6 + 6 * t, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------- HUD 与遮罩 ----------

function drawHud(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  options: RenderOptions,
): void {
  ctx.save();
  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`🚆 已送达 ${state.delivered}/${state.scenario.deliverTarget}`, 16, 12);

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#7f8c8d';
  const active = describeActive(state.activeEvents);
  ctx.fillText(
    `线路 ${state.lines.length}/${MAX_LINES}   时间 ${Math.floor(state.elapsed)}s${
      active ? `   ⚡ ${active}` : ''
    }   ${state.phase === 'paused' ? '⏸ 已暂停' : state.phase === 'ready' ? '▶ 点击开始' : ''}`,
    16,
    40,
  );

  // 剧本标题
  ctx.fillStyle = '#34495e';
  ctx.font = 'italic 13px sans-serif';
  ctx.fillText(`「${state.scenario.cityName}」 ${state.scenario.description}`, 16, 62);

  // 右上提示
  ctx.textAlign = 'right';
  ctx.fillStyle = '#95a5a6';
  ctx.font = '12px sans-serif';
  ctx.fillText(
    '拖站建线 · 端点延伸 · A 顾问 · M 自动 · N 新剧本 · R 重开 · P 暂停',
    width - 16,
    16,
  );

  // 右下：AI 状态
  if (options.aiStatus) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const isAuto = options.aiMode === 'auto';
    ctx.fillStyle = isAuto ? '#16a085' : '#7f8c8d';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${isAuto ? '🤖 自动模式 · ' : ''}${options.aiStatus}`, width - 16, height - 12);
  }
  ctx.restore();
}

/** 底部顾问建议气泡。 */
function drawAdviceBubble(
  ctx: CanvasRenderingContext2D,
  advice: Advice | null | undefined,
  width: number,
  height: number,
): void {
  if (!advice) return;
  const boxW = 460;
  const boxH = 52;
  const x = (width - boxW) / 2;
  const y = height - boxH - 16;

  ctx.save();
  // 背景
  ctx.fillStyle = 'rgba(44,62,80,0.92)';
  roundRect(ctx, x, y, boxW, boxH, 10);
  ctx.fill();
  // 左侧图标
  ctx.fillStyle = '#f1c40f';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('💡', x + 12, y + boxH / 2);
  // 文案
  ctx.fillStyle = '#fff';
  ctx.font = '13px sans-serif';
  ctx.fillText(`AI 顾问：${advice.comment}`, x + 38, y + boxH / 2);
  ctx.restore();
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  options: RenderOptions,
  camera: Camera,
): void {
  if (state.phase === 'ready') {
    drawReadyPanel(ctx, width, height, state.difficulty, options.bestScores);
  } else if (state.phase === 'gameover') {
    drawGameOverPanel(ctx, state, width, height, options.newRecord, options.newlyUnlocked);
  } else if (state.phase === 'paused') {
    drawPausePanel(ctx, width, height, options.aiMode ?? 'manual');
  }
  // 教程遮罩在 running/paused 之上叠加（教程态时游戏推进已暂停）
  if (options.tutorialStep && options.tutorialStep > 0) {
    drawTutorialOverlay(ctx, options.tutorialStep, state, width, height, camera);
  }
}

/** 暂停菜单：居中竖排按钮列表。 */
function drawPausePanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  aiMode: 'manual' | 'auto',
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, width, height);

  // 标题
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⏸ 已暂停', width / 2, height / 2 - 120);

  const items = pauseMenuLayout(width, height, aiMode);
  for (const it of items) {
    const r = it.rect;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(241,196,15,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '15px sans-serif';
    ctx.fillText(it.label, r.x + r.w / 2, r.y + r.h / 2);
  }

  ctx.fillStyle = '#95a5a6';
  ctx.font = '12px sans-serif';
  ctx.fillText('按 P 或点击「继续」恢复游戏', width / 2, height / 2 + 130);
  ctx.restore();
}

/**
 * 教程遮罩：半透明压暗 + 高亮目标区域 + 说明气泡。
 * 高亮目标根据 step 选择（建线高亮两站、列车高亮一列车、道具高亮背包、堵爆高亮最堵站）。
 */
function drawTutorialOverlay(
  ctx: CanvasRenderingContext2D,
  step: TutorialStep,
  state: GameState,
  width: number,
  height: number,
  camera: Camera,
): void {
  if (step <= 0) return;
  const text = TUTORIAL_TEXT[step as 1 | 2 | 3 | 4];

  ctx.save();
  // 半透明压暗全屏
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, width, height);

  // 选取高亮目标（pickHighlight 返回屏幕坐标，已用 camera 转换）
  const highlight = pickHighlight(state, step, width, height, camera);
  if (highlight) {
    // 挖出高亮圈（用更亮的覆盖）
    ctx.strokeStyle = 'rgba(241,196,15,0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(highlight.x, highlight.y, highlight.r, 0, Math.PI * 2);
    ctx.stroke();
    // 内圈淡光
    const grad = ctx.createRadialGradient(
      highlight.x,
      highlight.y,
      2,
      highlight.x,
      highlight.y,
      highlight.r,
    );
    grad.addColorStop(0, 'rgba(241,196,15,0.0)');
    grad.addColorStop(1, 'rgba(241,196,15,0.25)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(highlight.x, highlight.y, highlight.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 说明气泡（居中偏下）
  const boxW = 460;
  const boxH = 86;
  const bx = (width - boxW) / 2;
  const by = height - boxH - 60;
  ctx.fillStyle = 'rgba(44,62,80,0.96)';
  roundRect(ctx, bx, by, boxW, boxH, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(241,196,15,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#f1c40f';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text.title, bx + 18, by + 14);
  ctx.fillStyle = '#ecf0f1';
  ctx.font = '13px sans-serif';
  wrapText(ctx, text.body, bx + 18, by + 38, boxW - 36, 18);

  // 提示
  ctx.fillStyle = '#95a5a6';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  const isLast = step >= 4;
  ctx.fillText(
    isLast ? '点击/任意键 完成 →' : '点击/任意键 下一步 →  (右上角可跳过)',
    bx + boxW - 14,
    by + boxH - 16,
  );
  ctx.restore();
}

/** 世界坐标 → 屏幕坐标（与 render 的 ctx.scale(zoom).translate(-cam) 一致）。 */
function worldToScreen(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom };
}

/** 根据教程步骤选一个高亮目标（屏幕坐标 + 半径）。无合适目标时返回 null。 */
function pickHighlight(
  state: GameState,
  step: TutorialStep,
  width: number,
  height: number,
  camera: Camera,
): { x: number; y: number; r: number } | null {
  if (step === 1 && state.stations.length >= 2) {
    const a = state.stations[0]!;
    const s = worldToScreen(camera, a.pos.x, a.pos.y);
    return { x: s.x, y: s.y, r: 30 * camera.zoom };
  }
  if (step === 2 && state.trains.length > 0) {
    const t = state.trains[0]!;
    const line = state.lines.find((l) => l.id === t.lineId);
    if (line && line.stops.length >= 2) {
      const s0 = state.stations.find((s) => s.id === line.stops[0]);
      const s1 = state.stations.find((s) => s.id === line.stops[1]);
      if (s0 && s1) {
        const s = worldToScreen(camera, (s0.pos.x + s1.pos.x) / 2, (s0.pos.y + s1.pos.y) / 2);
        return { x: s.x, y: s.y, r: 26 * camera.zoom };
      }
    }
    return null;
  }
  if (step === 3) {
    // 高亮背包栏区域（右下，视口坐标）
    return { x: width - 64, y: height - 30, r: 50 };
  }
  if (step === 4) {
    // 高亮最堵的站（世界坐标转屏幕）
    let worst = state.stations[0] ?? null;
    for (const s of state.stations) {
      if (!worst || s.passengers.length > worst.passengers.length) worst = s;
    }
    if (worst) {
      const s = worldToScreen(camera, worst.pos.x, worst.pos.y);
      return { x: s.x, y: s.y, r: 32 * camera.zoom };
    }
  }
  return null;
}

/** 简单中文换行（按字符宽度估算）。 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  let line = '';
  let dy = 0;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, y + dy);
      line = ch;
      dy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y + dy);
}

/** ready 面板：标题 + 难度选择提示 + 各档历史最高。 */
function drawReadyPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  current: Difficulty,
  bestScores?: HighScores,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText('🚆 轨道调度', width / 2, height / 2 - 130);

  ctx.fillStyle = '#fff';
  ctx.font = '15px sans-serif';
  ctx.fillText('AI 将为你生成今日剧本 · A 顾问 · M 自动驾驶', width / 2, height / 2 - 88);

  // 难度四档（由 ALL_DIFFICULTIES 驱动，加档无需改渲染）
  const diffs = ALL_DIFFICULTIES;
  const boxW = 92;
  const gap = 12;
  const totalW = diffs.length * boxW + (diffs.length - 1) * gap;
  diffs.forEach((d, i) => {
    const bx = width / 2 - totalW / 2 + i * (boxW + gap);
    const by = height / 2 - 40;
    const selected = d === current;
    ctx.fillStyle = selected ? '#f1c40f' : 'rgba(255,255,255,0.15)';
    roundRect(ctx, bx, by, boxW, 44, 8);
    ctx.fill();
    ctx.fillStyle = selected ? '#2c3e50' : '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`${DIFFICULTY_NAME[d]} (${i + 1})`, bx + boxW / 2, by + 16);
    ctx.font = '11px sans-serif';
    const best = bestScores ? bestScores[d] : 0;
    ctx.fillText(best > 0 ? `最高 ${best}` : '尚无记录', bx + boxW / 2, by + 32);
  });

  ctx.fillStyle = '#ecf0f1';
  ctx.font = '14px sans-serif';
  ctx.fillText('按 1/2/3/4 选难度，再点击或按任意键开始', width / 2, height / 2 + 40);
  ctx.restore();
}

/** Game Over 面板：多行战绩。 */
function drawGameOverPanel(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  newRecord?: boolean,
  newlyUnlocked?: string[],
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#c0392b';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('线路瘫痪了！', width / 2, height / 2 - 140);

  // 战绩行
  const reached = state.delivered >= state.scenario.deliverTarget;
  const rows = [
    `送达  ${state.delivered} / ${state.scenario.deliverTarget} ${reached ? '🏆 达标' : ''}`,
    `存活  ${Math.floor(state.elapsed)} 秒`,
    `线路  ${state.lines.length} 条`,
    `最高连击  x${state.maxCombo}`,
    `难度  ${DIFFICULTY_NAME[state.difficulty]}`,
  ];
  ctx.fillStyle = '#fff';
  ctx.font = '17px sans-serif';
  rows.forEach((r, i) => {
    ctx.fillText(r, width / 2, height / 2 - 70 + i * 30);
  });

  if (newRecord) {
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('⭐ 新纪录！', width / 2, height / 2 + 100);
  }

  // 新解锁成就
  if (newlyUnlocked && newlyUnlocked.length > 0) {
    ctx.fillStyle = '#16a085';
    ctx.font = 'bold 14px sans-serif';
    const yOffset = newRecord ? 128 : 108;
    ctx.fillText(`🎉 新成就解锁（${newlyUnlocked.length}）`, width / 2, height / 2 + yOffset);
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '12px sans-serif';
    const labels = newlyUnlocked
      .slice(0, 4)
      .map((id) => {
        const a = getAchievement(id);
        return `${a.icon} ${a.name}`;
      })
      .join('  ');
    ctx.fillText(labels, width / 2, height / 2 + yOffset + 20);
  }

  ctx.fillStyle = '#bdc3c7';
  ctx.font = '14px sans-serif';
  ctx.fillText('按 R 或点击重新开始（回到难度选择）', width / 2, height / 2 + 140);
  ctx.restore();
}

// ---------- 形状绘制原语 ----------

/** 画一个形状，默认以原点为中心；可指定中心 (cx,cy) 与半径。 */
function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, r: number, cx = 0, cy = 0): void {
  const path = new Path2D();
  switch (shape) {
    case 'circle':
      path.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'triangle':
      path.moveTo(cx, cy - r);
      path.lineTo(cx + r, cy + r * 0.8);
      path.lineTo(cx - r, cy + r * 0.8);
      path.closePath();
      break;
    case 'square':
      path.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'diamond':
      path.moveTo(cx, cy - r);
      path.lineTo(cx + r, cy);
      path.lineTo(cx, cy + r);
      path.lineTo(cx - r, cy);
      path.closePath();
      break;
    case 'star':
      starPath(path, cx, cy, r, r * 0.45, 5);
      break;
  }
  // 把 path 填给当前 ctx（由调用方决定 fill/stroke）
  // 这里直接用 ctx.fill(path)/stroke(path) 不便，改为把命令直接重放到 ctx 上：
  replayPath(ctx, path);
}

/** 把 Path2D 的命令重放到 ctx（这样调用方的 fill()/stroke() 生效）。 */
function replayPath(ctx: CanvasRenderingContext2D, path: Path2D): void {
  // 直接用 ctx 接受 Path2D 的 fill/stroke 重载
  ctx.fill(path);
  ctx.stroke(path);
}

function starPath(
  p: Path2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
): void {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
}

/** 圆角矩形辅助（直接在当前 ctx 上画路径）。 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 供 input.ts 用的线路颜色查找。 */
export function colorOf(color: LineColor): string {
  return LINE_CSS[color];
}
