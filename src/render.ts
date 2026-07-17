// Canvas 渲染层。只读 GameState，不修改它。
// 负责把站点、线路、列车、乘客计数、HUD 和结束遮罩画到画布上。

import { STATION_CAPACITY, STATION_RADIUS } from './game/config.ts';
import type { GameState, LineColor, Shape, Station, Vec2 } from './game/types.ts';
import { linePoints, trainPosition } from './game/simulation.ts';
import { lerpVec2 } from './game/geometry.ts';
import { describeActive } from './game/events.ts';
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
}

/** 主绘制入口。 */
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  options: RenderOptions = {},
): void {
  clearBackground(ctx, width, height);
  drawLines(ctx, state);
  drawDragPreview(ctx, options);
  drawPowerUps(ctx, state);
  drawTrains(ctx, state, options.alpha);
  drawStations(ctx, state);
  drawHud(ctx, state, width, options);
  drawInventory(ctx, state, width, height);
  drawAdviceBubble(ctx, options.advice, width, height);
  drawOverlay(ctx, state, width, height);
}

function clearBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, w, h);
}

// ---------- 线路 ----------

function drawLines(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  for (const line of state.lines) {
    const pts = linePoints(state, line);
    if (pts.length < 2) continue;
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

const POWERUP_EMOJI: Record<'speed' | 'clear' | 'deliver', string> = {
  speed: '⚡',
  clear: '🧹',
  deliver: '📦',
};

function drawPowerUps(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const pu of state.powerUps) {
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
  const slots: Array<{ key: string; type: 'speed' | 'clear' | 'deliver' }> = [
    { key: '1', type: 'speed' },
    { key: '2', type: 'clear' },
    { key: '3', type: 'deliver' },
  ];
  const boxW = 96;
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
    const mult = 1 + Math.floor(state.combo.count / 5) * 0.5;
    ctx.fillText(`🔥 连击 x${state.combo.count} (${mult}倍)`, 16, height - 28);
    // 连击剩余时间条
    const ratio = Math.max(0, state.combo.timer / 3);
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
const prevTrainPositions = new Map<number, Vec2>();

function drawTrains(ctx: CanvasRenderingContext2D, state: GameState, alpha?: number): void {
  const liveLineIds = new Set<number>();
  for (const train of state.trains) {
    const line = state.lines.find((l) => l.id === train.lineId);
    if (!line) continue;
    liveLineIds.add(train.lineId);

    const curr = trainPosition(state, train);
    // 停靠中（dwellTimer>0）位置不变，无需插值；否则在 prev→curr 间 lerp。
    const prev = prevTrainPositions.get(train.lineId);
    const pos =
      alpha !== undefined && prev !== undefined && train.dwellTimer <= 0
        ? lerpVec2(prev, curr, alpha)
        : curr;
    prevTrainPositions.set(train.lineId, curr);
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
  // 清理已不存在的列车的陈旧缓存，防止 Map 无限增长。
  for (const id of prevTrainPositions.keys()) {
    if (!liveLineIds.has(id)) prevTrainPositions.delete(id);
  }
}

// ---------- 站点 ----------

function drawStations(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const station of state.stations) {
    drawStation(ctx, station);
    drawPassengerBadges(ctx, station);
    drawOverloadRing(ctx, station);
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

/** 站点过载时画一个红色警告环，半径随过载时间膨胀。 */
function drawOverloadRing(ctx: CanvasRenderingContext2D, station: Station): void {
  if (station.passengers.length < STATION_CAPACITY) return;
  const t = Math.min(1, station.overloadTimer / 6 /* OVERLOAD_GRACE */);
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
    `线路 ${state.lines.length}/7   时间 ${Math.floor(state.elapsed)}s${
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
    ctx.fillText(
      `${isAuto ? '🤖 自动模式 · ' : ''}${options.aiStatus}`,
      width - 16,
      WORLD_HEIGHT_USED - 12,
    );
  }
  ctx.restore();
}

// drawHud 引用的画布高度（与 WORLD_HEIGHT 一致，避免循环导入 config 仅为此一项）。
const WORLD_HEIGHT_USED = 600;

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
): void {
  if (state.phase === 'ready') {
    drawCenterPanel(
      ctx,
      width,
      height,
      '🚆 轨道调度',
      '点击画面或按任意键开始\nAI 将为你生成今日剧本\nA 顾问建议 · M 自动驾驶',
      '#2c3e50',
    );
  } else if (state.phase === 'gameover') {
    drawCenterPanel(
      ctx,
      width,
      height,
      '线路瘫痪了！',
      `共送达 ${state.delivered} 名乘客\n按 R 或点击重新开始`,
      '#c0392b',
    );
  }
}

function drawCenterPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  body: string,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(title, width / 2, height / 2 - 30);
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  const lines = body.split('\n');
  lines.forEach((ln, i) => {
    ctx.fillText(ln, width / 2, height / 2 + 20 + i * 24);
  });
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
