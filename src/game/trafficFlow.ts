/**
 * R14-D6（agenttrain）：交通流量分析器。
 *
 * congestion.ts 分析「站点拥堵」，但缺「流量」——单位时间经过某点的乘客量。
 * 本模块补：
 *   - computeTrafficFlow：估算每条线路的流量（乘客/分钟）
 *   - identifyBottlenecks：找出瓶颈线路（流量高但列车少）
 *   - flowBalance：评估网络整体的流量均衡度
 *
 * 纯函数。
 */

/** 单条线路的流量估算 */
export interface LineFlow {
  /** 线路标识（颜色或 id） */
  lineId: string;
  /** 估算流量（乘客/分钟） */
  flowPerMin: number;
  /** 列车数 */
  trainCount: number;
  /** 每列车负载（flow / trainCount） */
  loadPerTrain: number;
  /** 是否为瓶颈 */
  isBottleneck: boolean;
}

/** 网络流量报告 */
export interface TrafficFlowReport {
  /** 各线路流量 */
  lines: LineFlow[];
  /** 总流量 */
  totalFlow: number;
  /** 平均流量 */
  avgFlow: number;
  /** 瓶颈线路数 */
  bottleneckCount: number;
  /** 流量均衡度（变异系数 CV，越低越均衡） */
  balanceCV: number;
  /** 建议 */
  advice: string;
}

/**
 * 估算单条线路的流量。
 *
 * @param lineId 线路标识
 * @param deliveredPerMin 该线路每分钟送达数
 * @param trainCount 列车数
 * @param bottleneckThreshold 瓶颈阈值（每列车负载超过此值视为瓶颈）
 */
export function computeLineFlow(
  lineId: string,
  deliveredPerMin: number,
  trainCount: number,
  bottleneckThreshold = 2.0,
): LineFlow {
  const flowPerMin = Math.max(0, deliveredPerMin);
  const loadPerTrain = trainCount > 0 ? flowPerMin / trainCount : flowPerMin;
  return {
    lineId,
    flowPerMin,
    trainCount,
    loadPerTrain,
    isBottleneck: trainCount > 0 && loadPerTrain > bottleneckThreshold,
  };
}

/**
 * 分析整个网络的流量。
 */
export function analyzeTrafficFlow(
  lines: Array<{ lineId: string; deliveredPerMin: number; trainCount: number }>,
): TrafficFlowReport {
  if (lines.length === 0) {
    return {
      lines: [], totalFlow: 0, avgFlow: 0,
      bottleneckCount: 0, balanceCV: 0,
      advice: '尚无线路数据',
    };
  }

  const flows = lines.map((l) =>
    computeLineFlow(l.lineId, l.deliveredPerMin, l.trainCount),
  );
  const totalFlow = flows.reduce((s, f) => s + f.flowPerMin, 0);
  const avgFlow = totalFlow / flows.length;
  const bottleneckCount = flows.filter((f) => f.isBottleneck).length;

  // 变异系数 CV = std / mean
  const variance = flows.reduce((s, f) => s + (f.flowPerMin - avgFlow) ** 2, 0) / flows.length;
  const std = Math.sqrt(variance);
  const balanceCV = avgFlow > 0 ? std / avgFlow : 0;

  let advice: string;
  if (bottleneckCount > 0) {
    const names = flows.filter((f) => f.isBottleneck).map((f) => f.lineId).join(', ');
    advice = `${bottleneckCount} 条线路过载（${names}），建议增配列车`;
  } else if (balanceCV > 0.5) {
    advice = '线路间流量差异大，考虑重新分配列车';
  } else if (avgFlow > 5) {
    advice = '整体流量健康，运输效率高';
  } else {
    advice = '整体流量偏低，可优化线路覆盖';
  }

  return { lines: flows, totalFlow, avgFlow, bottleneckCount, balanceCV, advice };
}

/**
 * 找出瓶颈线路。
 */
export function identifyBottlenecks(report: TrafficFlowReport): LineFlow[] {
  return report.lines.filter((l) => l.isBottleneck);
}

/**
 * 评估流量均衡度。
 */
export function flowBalance(report: TrafficFlowReport): '均衡' | '略偏' | '不均' {
  if (report.lines.length === 0) return '均衡';
  if (report.balanceCV < 0.2) return '均衡';
  if (report.balanceCV < 0.5) return '略偏';
  return '不均';
}
