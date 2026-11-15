import type { ReactNode } from 'react';

export interface PanelInspection {
  shadePct: number;
  monthlyShadeRatios: number[];
  removed: boolean;
}

export function PanelShadeDetails({ panel, children }: { panel: PanelInspection; children?: ReactNode }) {
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <strong>{panel.removed ? '已剔除板位' : '保留模組'} · 年遮蔭 {panel.shadePct.toFixed(1)}%</strong>
        {children}
      </div>
      <div className="grid grid-cols-4 gap-x-2 gap-y-1 tabular-nums">
        {panel.monthlyShadeRatios.map((ratio, index) => (
          <span key={index}>{index + 1}月 {(ratio * 100).toFixed(1)}%</span>
        ))}
      </div>
    </div>
  );
}
