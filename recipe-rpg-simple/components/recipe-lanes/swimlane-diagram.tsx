import React, { useMemo, useRef } from 'react';
import type { RecipeGraph, RecipeNode } from '../../lib/recipe-lanes/types';
import { calculateLayout } from '../../lib/recipe-lanes/layout';

interface SwimlaneDiagramProps {
  graph: RecipeGraph;
}

const LANE_WIDTH = 400; // Matches layout.ts
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
          <filter id="icon-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000000" floodOpacity="0.15" />
          </filter>
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

        {/* Lanes Background */}
        {layout.lanes.map((lane, index) => (
          <g key={lane.id}>
            <rect
              x={PADDING_LEFT + index * LANE_WIDTH}
              y={0}
              width={LANE_WIDTH}
              height={layout.height}
              fill={index % 2 === 0 ? '#F9FAFB' : '#FFFFFF'}
            />
            {/* Lane Header - Subtle */}
            <text
              x={PADDING_LEFT + index * LANE_WIDTH + LANE_WIDTH / 2}
              y={32}
              fontSize="16"
              fontWeight="800"
              fill="#E5E7EB" // Very subtle background text
              textAnchor="middle"
              style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
            >
              {lane.label}
            </text>
          </g>
        ))}

        {/* Edges */}
        {layout.edges.map((edge, i) => (
          <path
            key={i}
            d={edge.path}
            stroke="#9CA3AF"
            strokeWidth="2"
            strokeDasharray="4 4" // Dashed line for lighter feel? Or solid? Solid is clearer.
            fill="none"
            markerEnd="url(#arrowhead)"
            opacity="0.6"
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
  
  // Visual Specs
  const iconSize = isIngredient ? 64 : 96;
  const centerX = node.width / 2;
  const centerY = iconSize / 2; // Icon centered at top

  const IconImage = () => {
      if (data.iconUrl) {
          return (
              <image 
                href={data.iconUrl} 
                x={centerX - iconSize / 2} 
                y={0} 
                width={iconSize} 
                height={iconSize} 
                style={{ imageRendering: 'pixelated', filter: 'url(#icon-shadow)' }}
              />
          );
      }
      return (
        <g>
            <circle cx={centerX} cy={iconSize/2} r={iconSize/2 - 4} fill="#F3F4F6" />
            <text x={centerX} y={iconSize/2} fontSize="32" textAnchor="middle" dominantBaseline="middle">
            {isIngredient ? '🥕' : '🍳'}
            </text>
        </g>
      );
  };
  
  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      
      <IconImage />

      {/* Text Label - Below Icon */}
      <switch>
          <foreignObject x={0} y={iconSize + 8} width={node.width} height={node.height - iconSize - 8}>
            <div style={{ 
                fontSize: isIngredient ? '12px' : '13px', 
                fontWeight: isIngredient ? 500 : 700,
                color: '#1F2937', 
                textAlign: 'center', 
                lineHeight: '1.2',
                fontFamily: 'Inter, sans-serif'
            }}>
              {data.text}
            </div>
          </foreignObject>
      </switch>

      {/* Badges - Floating near icon */}
      {data.duration && (
         <g transform={`translate(${centerX + iconSize/2 - 10}, ${iconSize - 10})`}>
             <rect rx="4" ry="4" width="40" height="16" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1" />
             <text x="20" y="11" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#92400E">{data.duration}</text>
         </g>
      )}

      {data.temperature && (
         <g transform={`translate(${centerX - iconSize/2 - 30}, ${iconSize - 10})`}>
             <rect rx="4" ry="4" width="60" height="16" fill="#FEE2E2" stroke="#EF4444" strokeWidth="1" />
             <text x="30" y="11" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#B91C1C">{data.temperature}</text>
         </g>
      )}
    </g>
  );
};

export default SwimlaneDiagram;
