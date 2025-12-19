'use client';

import React, { useMemo, useRef } from 'react';
import type { RecipeGraph, RecipeNode } from '../../lib/recipe-lanes/types';
import { calculateLayout, LayoutMode } from '../../lib/recipe-lanes/layout';

interface SwimlaneDiagramProps {
  graph: RecipeGraph;
  mode?: LayoutMode;
  zoom?: number;
}

const SwimlaneDiagram: React.FC<SwimlaneDiagramProps> = ({ graph, mode = 'compact', zoom = 1 }) => {
  const layout = useMemo(() => calculateLayout(graph, mode), [graph, mode]);
  const svgRef = useRef<SVGSVGElement>(null);
  const isHorizontal = mode === 'horizontal';

  const downloadSVG = () => {
    if (svgRef.current) {
      const data = new XMLSerializer().serializeToString(svgRef.current);
      const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `recipe-lanes-${mode}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const downloadPNG = () => {
    if (svgRef.current) {
        const svgData = new XMLSerializer().serializeToString(svgRef.current);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        // Scale for high res
        const scale = 2;
        canvas.width = layout.width * scale;
        canvas.height = layout.height * scale;

        img.onload = () => {
            if (ctx) {
                ctx.scale(scale, scale);
                // Fill white background
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, layout.width, layout.height);
                ctx.drawImage(img, 0, 0);
                
                const pngUrl = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = pngUrl;
                link.download = `recipe-lanes-${mode}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        };

        // Handle SVG loading
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        img.src = url;
    }
  };

  // Determine Node Style based on Mode
  // "Lanes" (swimlanes) gets the minimal "Icon + Text" style requested by user.
  const nodeStyle = mode === 'swimlanes' ? 'minimal' : 'card';

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button 
            onClick={downloadPNG}
            className="px-3 py-2 bg-white border border-zinc-300 rounded text-xs font-medium hover:bg-zinc-50 transition-colors text-zinc-700"
        >
            Download PNG 🖼️
        </button>
        <button 
            onClick={downloadSVG}
            className="px-3 py-2 bg-white border border-zinc-300 rounded text-xs font-medium hover:bg-zinc-50 transition-colors text-zinc-700"
        >
            Download SVG 📥
        </button>
      </div>
      <div className="overflow-auto border border-zinc-200 rounded-lg bg-white w-full h-full relative">
        <svg 
            ref={svgRef} 
            width={layout.width * zoom} 
            height={layout.height * zoom} 
            style={{ fontFamily: 'Inter, sans-serif' }}
            // Add viewBox to ensure the content scales correctly if we used viewBox, 
            // but here we are using transform on <g> and sizing the SVG.
        >
        <g transform={`scale(${zoom})`}>
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
            {layout.lanes.map((lane) => {
            const headerX = isHorizontal ? 20 : lane.x + lane.width / 2;
            const headerY = isHorizontal ? lane.y + lane.height / 2 : 32;
            const textAnchor = isHorizontal ? "start" : "middle";
            
            return (
                <g key={lane.id}>
                <rect
                    x={lane.x}
                    y={lane.y}
                    width={lane.width}
                    height={lane.height}
                    fill={lane.color}
                />
                
                <text
                    x={headerX}
                    y={headerY}
                    fontSize="16"
                    fontWeight="800"
                    fill={isHorizontal ? "#9CA3AF" : "#E5E7EB"}
                    textAnchor={textAnchor}
                    dominantBaseline={isHorizontal ? "middle" : "auto"}
                    style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
                >
                    {lane.label}
                </text>

                {isHorizontal ? (
                    <line
                        x1={0}
                        y1={lane.y + lane.height}
                        x2={layout.width}
                        y2={lane.y + lane.height}
                        stroke="#E5E7EB"
                        strokeWidth="1"
                    />
                ) : (
                    <line
                        x1={lane.x + lane.width}
                        y1={0}
                        x2={lane.x + lane.width}
                        y2={layout.height}
                        stroke="#E5E7EB"
                        strokeWidth="1"
                    />
                )}
                </g>
            );
            })}

            {/* Edges */}
            {layout.edges.map((edge, i) => (
            <path
                key={i}
                d={edge.path}
                stroke="#9CA3AF"
                strokeWidth="2"
                strokeDasharray="4 4" 
                fill="none"
                markerEnd="url(#arrowhead)"
                opacity="0.6"
            />
            ))}

            {/* Nodes */}
            {layout.nodes.map((node) => (
            <Node key={node.data.id} node={node} style={nodeStyle} />
            ))}
        </g>
      </svg>
      </div>
    </div>
  );
};

const Node: React.FC<{ node: any, style?: 'card' | 'minimal' }> = ({ node, style = 'card' }) => {
  const data = node.data as RecipeNode;
  const isIngredient = data.type === 'ingredient';
  
  if (style === 'minimal') {
      // MINIMAL STYLE (Image + Text Underneath)
      const iconSize = 48; // Larger icon
      const iconX = node.width / 2;
      const iconY = node.height / 2 - 10;
      
      return (
        <g transform={`translate(${node.x}, ${node.y})`}>
             {/* Background (Optional, maybe just transparent or subtle hover) */}
             <rect
                width={node.width}
                height={node.height}
                rx={8}
                ry={8}
                fill="#FFFFFF"
                stroke="#E5E7EB"
                strokeWidth="1"
                filter="url(#icon-shadow)"
             />
             
             {data.iconUrl ? (
                 <image 
                    href={data.iconUrl} 
                    x={iconX - iconSize / 2} 
                    y={10} 
                    width={iconSize} 
                    height={iconSize} 
                    style={{ imageRendering: 'pixelated' }}
                 />
             ) : (
                <text x={iconX} y={40} fontSize="24" textAnchor="middle">
                   {isIngredient ? '🥕' : '🍳'}
                </text>
             )}

             <text
                x={node.width / 2}
                y={node.height - 25}
                textAnchor="middle"
                fontSize="11"
                fill="#374151"
                fontWeight="500"
                width={node.width - 10}
             >
                {/* Simple truncation or multiline? SVG text wrapping is hard without foreignObject */}
                {data.text.length > 25 ? data.text.substring(0, 22) + '...' : data.text}
             </text>
             
             {/* Full text in ForeignObject for wrapping if needed, but simple text is cleaner for minimal */}
              <foreignObject x={5} y={node.height - 45} width={node.width - 10} height={40}>
                 <div className="flex items-center justify-center text-center h-full">
                    <span className="text-[10px] leading-tight text-zinc-600 line-clamp-2">
                        {data.text}
                    </span>
                 </div>
              </foreignObject>
        </g>
      );
  }

  // CARD STYLE (Existing)
  const iconSize = isIngredient ? 28 : 36;
  const iconX = isIngredient ? 20 : node.width - 25;
  const iconY = isIngredient ? node.height / 2 : 20;

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
        <text x={iconX} y={iconY} fontSize={isIngredient ? "14" : "18"} textAnchor="middle" dominantBaseline="middle">
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
          rx={node.height / 2} 
          ry={node.height / 2}
          fill="#FFFFFF"
          stroke="#D1D5DB"
          strokeWidth="1"
        />
        <IconImage />
        <text
          x={45}
          y={node.height / 2}
          dominantBaseline="middle"
          fontSize="11"
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
      
      <text x={10} y={18} fontSize="9" fontWeight="bold" fill="#4B5563">
        STEP {data.id.split('-').pop()}
      </text>

      <IconImage />

      <foreignObject x={8} y={34} width={node.width - 16} height={node.height - 40}>
        <div style={{ fontSize: '11px', color: '#1F2937', lineHeight: '1.3', height: '100%', display: 'flex', alignItems: 'center' }}>
          {data.text}
        </div>
      </foreignObject>
      
      {data.duration && (
         <text x={node.width - 50} y={18} fontSize="9" fill="#6B7280" textAnchor="end" fontWeight="500">
           ⏱ {data.duration}
         </text>
      )}

      {data.temperature && (
         <text x={node.width - 8} y={node.height - 6} fontSize="9" fill="#EF4444" textAnchor="end" fontWeight="bold">
           {data.temperature}
         </text>
      )}
    </g>
  );
};

export default SwimlaneDiagram;