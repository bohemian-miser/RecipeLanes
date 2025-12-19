import React, { useMemo, useRef } from 'react';
import type { RecipeGraph, RecipeNode } from '../../lib/recipe-lanes/types';
import { calculateLayout } from '../../lib/recipe-lanes/layout';

interface SwimlaneDiagramProps {
  graph: RecipeGraph;
}

const LANE_WIDTH = 360; // Matches layout.ts
const PADDING_LEFT = 40;

const SwimlaneDiagram: React.FC<SwimlaneDiagramProps> = ({ graph }) => {
  const layout = useMemo(() => calculateLayout(graph), [graph]);
  const svgRef = useRef<SVGSVGElement>(null);

  const downloadSVG = () => {
    if (svgRef.current) {
      const data = new XMLSerializer().serializeToString(svgRef.current);
      const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'recipe-lanes.svg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button 
        onClick={downloadSVG}
        className="px-3 py-2 bg-white border border-zinc-300 rounded text-sm font-medium hover:bg-zinc-50 transition-colors text-zinc-700"
      >
        Download SVG 📥
      </button>
      <div className="overflow-auto border border-zinc-200 rounded-lg bg-white w-full">
        <svg ref={svgRef} width={layout.width} height={layout.height} style={{ fontFamily: 'Inter, sans-serif' }}>
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF" />
          </marker>
        </defs>

        {/* Lanes */}
        {layout.lanes.map((lane, index) => (
          <g key={lane.id}>
            <rect
              x={PADDING_LEFT + index * LANE_WIDTH}
              y={0}
              width={LANE_WIDTH}
              height={layout.height}
              fill={index % 2 === 0 ? '#F9FAFB' : '#FFFFFF'}
            />
            {/* Lane Header */}
            <text
              x={PADDING_LEFT + index * LANE_WIDTH + LANE_WIDTH / 2}
              y={24}
              fontSize="14"
              fontWeight="700"
              fill="#374151"
              textAnchor="middle"
              style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {lane.label}
            </text>
            <line
              x1={PADDING_LEFT + (index + 1) * LANE_WIDTH}
              y1={0}
              x2={PADDING_LEFT + (index + 1) * LANE_WIDTH}
              y2={layout.height}
              stroke="#E5E7EB"
              strokeWidth="1"
            />
          </g>
        ))}

        {/* Edges */}
        {layout.edges.map((edge, i) => (
          <path
            key={i}
            d={edge.path}
            stroke="#9CA3AF"
            strokeWidth="2"
            fill="none"
            markerEnd="url(#arrowhead)"
          />
        ))}

        {/* Nodes */}
        {layout.nodes.map((node) => (
          <Node key={node.data.id} node={node} />
        ))}
      </svg>
      </div>
    </div>
  );
};

const Node: React.FC<{ node: any }> = ({ node }) => {
  const data = node.data as RecipeNode;
  const isIngredient = data.type === 'ingredient';
  
  // Icon Size logic
  const iconSize = isIngredient ? 32 : 48;
  const iconX = isIngredient ? 25 : node.width - 30;
  const iconY = isIngredient ? node.height / 2 : 24;

  const IconImage = () => {
      if (data.iconUrl) {
          return (
              <image 
                href={data.iconUrl} 
                x={iconX - iconSize / 2} 
                y={iconY - iconSize / 2} 
                width={iconSize} 
                height={iconSize} 
                style={{ imageRendering: 'pixelated' }}
              />
          );
      }
      return (
        <text x={iconX} y={iconY} fontSize={isIngredient ? "16" : "22"} textAnchor="middle" dominantBaseline="middle">
          {isIngredient ? '🥕' : '🍳'}
        </text>
      );
  };
  
  if (isIngredient) {
    return (
      <g transform={`translate(${node.x}, ${node.y})`}>
        <rect
          width={node.width}
          height={node.height}
          rx={20}
          ry={20}
          fill="#FFFFFF"
          stroke="#D1D5DB"
          strokeWidth="1"
        />
        <IconImage />
        <text
          x={55}
          y={node.height / 2}
          dominantBaseline="middle"
          fontSize="13"
          fill="#111827"
          fontWeight="500"
        >
          {data.text}
        </text>
      </g>
    );
  }

  // Action Node
  const isHeating = !!data.temperature;
  const strokeColor = isHeating ? '#FCA5A5' : '#D1D5DB';
  const strokeWidth = isHeating ? 2 : 1;

  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      <rect
        x={3}
        y={3}
        width={node.width}
        height={node.height}
        rx={8}
        ry={8}
        fill="rgba(0,0,0,0.05)"
      />
      <rect
        width={node.width}
        height={node.height}
        rx={8}
        ry={8}
        fill="#FFFFFF"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
      
      {/* Header Band */}
      <path
        d={`M 0 8 Q 0 0 8 0 L ${node.width - 8} 0 Q ${node.width} 0 ${node.width} 8 L ${node.width} 32 L 0 32 Z`}
        fill={isHeating ? '#FEF2F2' : '#F3F4F6'}
      />
      
      <text x={10} y={21} fontSize="11" fontWeight="bold" fill="#4B5563">
        STEP {data.id.split('-').pop()}
      </text>

      <IconImage />

      {/* Description */}
      <foreignObject x={10} y={40} width={node.width - 20} height={node.height - 45}>
        <div style={{ fontSize: '13px', color: '#1F2937', lineHeight: '1.4', height: '100%', display: 'flex', alignItems: 'center' }}>
          {data.text}
        </div>
      </foreignObject>
      
      {data.duration && (
         <text x={node.width - 60} y={21} fontSize="11" fill="#6B7280" textAnchor="end" fontWeight="500">
           ⏱ {data.duration}
         </text>
      )}

      {data.temperature && (
         <text x={node.width - 10} y={node.height - 8} fontSize="10" fill="#EF4444" textAnchor="end" fontWeight="bold">
           {data.temperature}
         </text>
      )}
    </g>
  );
};

export default SwimlaneDiagram;
