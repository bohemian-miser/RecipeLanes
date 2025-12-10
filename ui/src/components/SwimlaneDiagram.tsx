import React, { useMemo, useRef } from 'react';
import type { RecipeGraph, VisualNode } from '../types';
import { calculateLayout } from '../utils/layout';

interface SwimlaneDiagramProps {
  graph: RecipeGraph;
}

const LANE_WIDTH = 260; // Must match layout.ts (ideally import const)
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
      <button 
        onClick={downloadSVG}
        style={{
          padding: '8px 12px',
          background: '#fff',
          border: '1px solid #D1D5DB',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 500
        }}
      >
        Download SVG 📥
      </button>
      <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff' }}>
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

        {/* Lanes (Vertical Columns) */}
        {layout.lanes.map((lane, index) => (
          <g key={lane.name}>
            <rect
              x={PADDING_LEFT + index * LANE_WIDTH}
              y={0}
              width={LANE_WIDTH}
              height={layout.height}
              fill={lane.color}
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
              {lane.name}
            </text>
            {/* Divider Line */}
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
        {layout.edges.map((edge) => (
          <path
            key={edge.id}
            d={edge.path}
            stroke="#9CA3AF"
            strokeWidth="2"
            fill="none"
            markerEnd="url(#arrowhead)"
          />
        ))}

        {/* Nodes */}
        {layout.nodes.map((node) => (
          <Node key={node.id} node={node} />
        ))}
      </svg>
      </div>
    </div>
  );
};

const Node: React.FC<{ node: VisualNode }> = ({ node }) => {
  if (node.type === 'ingredient') {
    const ing = node.data as any; 
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
        {/* Ingredient Icon - Larger */}
        <text x={25} y={26} fontSize="20" textAnchor="middle" dominantBaseline="middle">
          {ing.icon}
        </text>
        <text
          x={50}
          y={node.height / 2}
          dominantBaseline="middle"
          fontSize="13"
          fill="#111827"
          fontWeight="500"
        >
          {ing.quantity ? `${ing.quantity} ` : ''}{ing.name}
        </text>
      </g>
    );
  }

  const step = node.data as any;
  const isHeating = step.resourceType === 'cook';
  const strokeColor = isHeating ? '#FCA5A5' : '#D1D5DB';
  const strokeWidth = isHeating ? 2 : 1;
  const bgColor = '#FFFFFF';

  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      {/* Shadow */}
      <rect
        x={3}
        y={3}
        width={node.width}
        height={node.height}
        rx={8}
        ry={8}
        fill="rgba(0,0,0,0.05)"
      />
      {/* Main Box */}
      <rect
        width={node.width}
        height={node.height}
        rx={8}
        ry={8}
        fill={bgColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
      
      {/* Header Band */}
      <path
        d={`M 0 8 Q 0 0 8 0 L ${node.width - 8} 0 Q ${node.width} 0 ${node.width} 8 L ${node.width} 32 L 0 32 Z`}
        fill={isHeating ? '#FEF2F2' : '#F3F4F6'}
      />
      
      {/* Step Number */}
      <text x={10} y={21} fontSize="11" fontWeight="bold" fill="#4B5563">
        STEP {step.label}
      </text>

      {/* Main Icon - Top Right */}
      <text x={node.width - 25} y={20} fontSize="22" textAnchor="middle" dominantBaseline="middle">
        {step.icon}
      </text>

      {/* Duration Badge - Top Right (Left of Icon) */}
      <g transform={`translate(${node.width - 50}, 20)`} textAnchor="end">
         {step.duration && (
           <text x={0} y={0} fontSize="11" fill="#6B7280" textAnchor="end" fontWeight="500">
             ⏱ {step.duration}
           </text>
         )}
      </g>

      {/* Description */}
      <switch>
        <foreignObject x={10} y={40} width={node.width - 20} height={node.height - 45}>
          <div style={{ fontSize: '13px', color: '#1F2937', lineHeight: '1.4', overflow: 'hidden', height: '100%' }}>
            {step.description}
          </div>
        </foreignObject>
      </switch>
      
      {/* Temperature Label (Bottom Right) */}
      {step.temperature && (
         <text x={node.width - 10} y={node.height - 8} fontSize="10" fill="#EF4444" textAnchor="end" fontWeight="bold">
           {step.temperature}
         </text>
      )}
    </g>
  );
};

export default SwimlaneDiagram;
