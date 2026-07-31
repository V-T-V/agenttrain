// 摄像机（视口）：地图缩放 + 平移，让 8 倍大地图真正可玩可看。
//
// 【关键约定 —— zoom 是「像素缩放因子」，与 ctx.scale 完全一致】
//   zoom=1 → 1 个世界单位 = 1 个屏幕像素
//   zoom=2 → 1 个世界单位 = 2 个屏幕像素（放大看局部）
//   zoom=0.5 → 2 个世界单位挤进 1 个屏幕像素（缩小看全局）
//
// 视口（显示窗口 displayW×displayH 像素）能看到的世界范围：
//   viewWidth  = displayW / zoom   （世界单位）
//   viewHeight = displayH / zoom   （世界单位）
//
// 屏幕↔世界换算（与 render 的 ctx.scale(zoom).translate(-cam) 严格一致）：
//   world = screen / zoom + (cam.x, cam.y)
//   screen = (world - cam) * zoom
//
// 这样 render、input、zoomAt 三处的 zoom 语义统一，不会再出现
// 「摄像机说看到整个世界、渲染却只画左上角」的不一致。

import { WORLD_HEIGHT, WORLD_WIDTH } from './config.ts';

/** 摄像机状态。 */
export interface Camera {
  /** 左上角在世界坐标系下的 x。 */
  x: number;
  /** 左上角在世界坐标系下的 y。 */
  y: number;
  /** 像素缩放因子（与 ctx.scale 一致）。 */
  zoom: number;
}

/** 视口能看到的世界宽（世界单位）= displayW / zoom。 */
export function viewWidth(cam: Camera, displayW: number): number {
  return displayW / cam.zoom;
}

/** 视口能看到的世界高（世界单位）= displayH / zoom。 */
export function viewHeight(cam: Camera, displayH: number): number {
  return displayH / cam.zoom;
}

/**
 * 创建一份「刚好装下整个世界」的初始摄像机。
 * zoom 取 min(displayW/WORLD_WIDTH, displayH/WORLD_HEIGHT)，保证世界完整可见；
 * 居中放置（由 clampPan 处理）。
 */
export function createCamera(displayW: number, displayH: number): Camera {
  const zoom = Math.min(displayW / WORLD_WIDTH, displayH / WORLD_HEIGHT);
  return clampPan({ x: 0, y: 0, zoom }, displayW, displayH);
}

/**
 * 以某点为锚点缩放（滚轮缩放：保持鼠标所指的世界点不动）。
 * @param anchorScreenX/Y 鼠标在「显示窗口」里的坐标（像素，左上为 0,0）
 * @param displayW/H 显示窗口的像素宽高
 * @param factor 滚轮缩放因子（>1 放大，<1 缩小）
 */
export function zoomAt(
  cam: Camera,
  anchorScreenX: number,
  anchorScreenY: number,
  displayW: number,
  displayH: number,
  factor: number,
): Camera {
  // 锚点在世界坐标系下的位置（缩放前）
  const worldX = anchorScreenX / cam.zoom + cam.x;
  const worldY = anchorScreenY / cam.zoom + cam.y;
  let zoom = cam.zoom * factor;
  zoom = clampZoom(zoom);
  // 缩放后，调整 cam.x/y 使锚点仍停留在同一屏幕位置：worldX = anchor/zoom + x → x = worldX - anchor/zoom
  const nx = worldX - anchorScreenX / zoom;
  const ny = worldY - anchorScreenY / zoom;
  return clampPan({ x: nx, y: ny, zoom }, displayW, displayH);
}

/**
 * 平移摄像机（拖拽地图：dx/dy 是显示窗口像素增量）。
 * 注意：屏幕像素增量需除以 zoom 才是世界单位增量。
 */
export function pan(
  cam: Camera,
  dxScreen: number,
  dyScreen: number,
  displayW: number,
  displayH: number,
): Camera {
  return clampPan(
    { x: cam.x - dxScreen / cam.zoom, y: cam.y - dyScreen / cam.zoom, zoom: cam.zoom },
    displayW,
    displayH,
  );
}

/** 把屏幕（显示窗口）坐标换算成世界坐标。 */
export function screenToWorld(
  cam: Camera,
  screenX: number,
  screenY: number,
  _displayW: number,
  _displayH: number,
): { x: number; y: number } {
  void _displayW;
  void _displayH;
  return {
    x: screenX / cam.zoom + cam.x,
    y: screenY / cam.zoom + cam.y,
  };
}

/** 缩放上下限，防止过度放大/缩小。 */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** 限制摄像机不越出世界边界（视口比世界小时）；视口比世界大时居中。 */
function clampPan(cam: Camera, displayW: number, displayH: number): Camera {
  const vw = viewWidth(cam, displayW);
  const vh = viewHeight(cam, displayH);
  let x = cam.x;
  let y = cam.y;
  if (vw >= WORLD_WIDTH) {
    x = (WORLD_WIDTH - vw) / 2;
  } else {
    x = Math.max(0, Math.min(WORLD_WIDTH - vw, x));
  }
  if (vh >= WORLD_HEIGHT) {
    y = (WORLD_HEIGHT - vh) / 2;
  } else {
    y = Math.max(0, Math.min(WORLD_HEIGHT - vh, y));
  }
  return { x, y, zoom: cam.zoom };
}
