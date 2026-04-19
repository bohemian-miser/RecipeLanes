/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

'use client';

import React, { memo } from 'react';
import { useStore } from 'reactflow';

export interface TimelineData {
  pixelsPerMin: number;
  totalMinutes: number;
  actionZoneY: number;
  totalHeight: number;
  rulerHeight: number;
  laneLabelWidth: number;
  gridInterval: number;
}

function TimelineBackground({ data }: { data: TimelineData }) {
  const transform = useStore((s: any) => s.transform as [number, number, number]);
  const [tx, ty, scale] = transform;

  const { pixelsPerMin: ppm, totalMinutes, actionZoneY, totalHeight, rulerHeight, laneLabelWidth, gridInterval } = data;

  const toSX = (cx: number) => cx * scale + tx;
  const toSY = (cy: number) => cy * scale + ty;

  const gridTicks: number[] = [];
  for (let t = 0; t <= Math.ceil(totalMinutes) + gridInterval; t += gridInterval) {
    gridTicks.push(t);
  }

  const gridTop = toSY(rulerHeight);
  const rulerBot = toSY(rulerHeight);

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'visible',
      }}
    >
      {/* Ruler background stripe */}
      <rect
        x={toSX(laneLabelWidth)}
        y={toSY(0)}
        width="100%"
        height={rulerHeight * scale}
        fill="white"
        opacity={0.92}
      />

      {/* Vertical grid lines + ruler minute labels */}
      {gridTicks.map(t => {
        const major = t % 10 === 0;
        const sx = toSX(laneLabelWidth + t * ppm);
        return (
          <g key={t}>
            <line
              x1={sx} y1={gridTop}
              x2={sx} y2="100%"
              stroke={major ? '#d4d4d8' : '#eeeeee'}
              strokeWidth={major ? 1 : 0.5}
              strokeDasharray={major ? undefined : '2 3'}
            />
            <text
              x={sx}
              y={toSY(rulerHeight - 5)}
              textAnchor="middle"
              fontSize={Math.max(9, 12 * scale)}
              fill={major ? '#52525b' : '#a1a1aa'}
              fontFamily="ui-monospace, monospace"
              fontWeight={major ? '600' : '400'}
            >
              {t}m
            </text>
          </g>
        );
      })}

      {/* Ruler bottom border */}
      <line
        x1={toSX(laneLabelWidth)} y1={rulerBot}
        x2="200%" y2={rulerBot}
        stroke="#d4d4d8" strokeWidth={1}
      />

      {/* Ingredient zone / action zone separator (dashed) */}
      <line
        x1={toSX(laneLabelWidth)} y1={toSY(actionZoneY)}
        x2="200%" y2={toSY(actionZoneY)}
        stroke="#e4e4e7" strokeWidth={0.75}
        strokeDasharray="4 3"
      />

      {/* Lane label gutter right edge */}
      <line
        x1={toSX(laneLabelWidth)} y1={toSY(rulerHeight)}
        x2={toSX(laneLabelWidth)} y2="100%"
        stroke="#e4e4e7" strokeWidth={1}
      />
    </svg>
  );
}

export default memo(TimelineBackground);
