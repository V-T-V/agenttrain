// 自动驾驶工具：把 simulation 的建/延/删线包成 ToolDef，
// 供 autopilot 通过 function-calling 调用。
// 工具按「形状」而非 id 来描述参数（LLM 看不到内部 id，但看得见形状），
// 由工具内部把形状解析成具体站点 id。

import type { ToolDef } from './types.ts';
import { shapeName } from './advisor.ts';
import { createLine, extendLine, removeLine } from '../game/simulation.ts';
import type { GameState, LineColor, Shape } from '../game/types.ts';

/** 找一个指定形状、且未被某条线端点占用的站点（供 create/extend 选目标）。 */
function findStationByShape(state: GameState, shape: Shape): number | null {
  // 优先选最堵的同形状站
  const candidates = state.stations
    .filter((s) => s.shape === shape)
    .sort((a, b) => b.passengers.length - a.passengers.length);
  return candidates[0]?.id ?? null;
}

/** 找一条可延伸的线路（端点形状匹配 from），返回 {lineId, atStart}。 */
function findExtendableLine(
  state: GameState,
  fromShape: Shape,
): {
  lineId: number;
  atStart: boolean;
} | null {
  for (const line of state.lines) {
    if (line.stops.length === 0) continue;
    const head = line.stops[0]!;
    const tail = line.stops[line.stops.length - 1]!;
    const headShape = state.stations.find((s) => s.id === head)?.shape;
    const tailShape = state.stations.find((s) => s.id === tail)?.shape;
    if (headShape === fromShape) return { lineId: line.id, atStart: true };
    if (tailShape === fromShape) return { lineId: line.id, atStart: false };
  }
  return null;
}

/**
 * 构造一组工具定义，闭包捕获当前 state（每次调用都传最新 state 重建）。
 * 这样 LLM 调用 create_line({fromShape, toShape}) 时，工具能解析成正确的站点。
 */
export function buildAutopilotTools(state: GameState): ToolDef<Record<string, unknown>>[] {
  const availableShapes = [...new Set(state.stations.map((s) => s.shape))] as Shape[];

  const createLineTool: ToolDef<{ fromShape: Shape; toShape: Shape }> = {
    name: 'create_line',
    description: `新建一条线路，连接两个不同形状的站点。可用形状: ${availableShapes
      .map((s) => `${shapeName(s)}=${s}`)
      .join(', ')}。最多 7 条线。`,
    parameters: {
      type: 'object',
      properties: {
        fromShape: { type: 'string', enum: availableShapes, description: '起点站形状' },
        toShape: { type: 'string', enum: availableShapes, description: '终点站形状' },
      },
      required: ['fromShape', 'toShape'],
    },
    execute({ fromShape, toShape }) {
      const from = findStationByShape(state, fromShape);
      const to = findStationByShape(state, toShape);
      if (from === null || to === null) return { ok: false, reason: '找不到该形状的站点' };
      const ok = createLine(state, from, to);
      return ok ? { ok: true } : { ok: false, reason: '建线失败（可能已达上限）' };
    },
  };

  const extendLineTool: ToolDef<{ fromShape: Shape; toShape: Shape }> = {
    name: 'extend_line',
    description:
      '把一条以 fromShape 站为端点的现有线路，延伸到 toShape 站。如果没有可延伸的线，请改用 create_line。',
    parameters: {
      type: 'object',
      properties: {
        fromShape: { type: 'string', enum: availableShapes, description: '线路端点站形状' },
        toShape: { type: 'string', enum: availableShapes, description: '要延伸到的目标形状' },
      },
      required: ['fromShape', 'toShape'],
    },
    execute({ fromShape, toShape }) {
      const target = findExtendableLine(state, fromShape);
      if (!target) return { ok: false, reason: '没有可从该形状延伸的线路' };
      const to = findStationByShape(state, toShape);
      if (to === null) return { ok: false, reason: '找不到目标形状站点' };
      const ok = extendLine(state, target.lineId, to, target.atStart);
      return ok ? { ok: true } : { ok: false, reason: '延伸失败' };
    },
  };

  const removeLineTool: ToolDef<{ color: LineColor }> = {
    name: 'remove_line',
    description: '删除一条线路（按颜色）。当线路冗余或走线很差时使用。',
    parameters: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: '要删除的线路颜色',
        },
      },
      required: ['color'],
    },
    execute({ color }) {
      const line = state.lines.find((l) => l.color === color);
      if (!line) return { ok: false, reason: '没有该颜色的线路' };
      removeLine(state, line.id);
      return { ok: true };
    },
  };

  // 工具带各自的强类型参数；统一擦除成 Record<string,unknown> 以便放入同构数组。
  return [createLineTool, extendLineTool, removeLineTool] as ToolDef<Record<string, unknown>>[];
}
