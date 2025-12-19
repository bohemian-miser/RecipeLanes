import React, { useMemo, useRef } from 'react';
import type { RecipeGraph, RecipeNode } from '../../lib/recipe-lanes/types';
import { calculateLayout, LayoutMode } from '../../lib/recipe-lanes/layout';
import { toPng } from 'html-to-image';

interface SwimlaneDiagramProps {
  graph: RecipeGraph;
  mode?: LayoutMode;
  zoom?: number;
}

const SwimlaneDiagram: React.FC<SwimlaneDiagramProps> = ({ graph, mode = 'compact', zoom = 1 }) => {
  const layout = useMemo(() => calculateLayout(graph, mode), [graph, mode]);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  const downloadPNG = async () => {
    if (containerRef.current) {
        try {
            // We capture the container, but we need to ensure it's fully visible/sized?
            // Actually capturing the SVG element directly is usually better if it has dimensions.
            // But html-to-image works best on DOM elements.
            // Let's target the wrapper div or the svg itself.
            // Note: toPng might need the element to be visible and not scaled down too much.
            // We might want to temporarily reset zoom or capture a specific node.
            
            // Using the SVG ref often works well if styles are inline.
            const dataUrl = await toPng(containerRef.current as HTMLElement, { 
                cacheBust: true, 
                backgroundColor: '#ffffff',
                pixelRatio: 2 // High res
            });
            
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `recipe-lanes-${mode}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error('PNG Download failed:', err);
        }
    }
  };

  // Determine Node Style based on Mode
  // "Lanes" and "Smart" (Dagre) get the minimal style.
  const nodeStyle = (mode === 'swimlanes' || mode === 'dagre') ? 'minimal' : 'card';

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
      {/* Container for PNG capture */}
      <div ref={containerRef} className="overflow-auto border border-zinc-200 rounded-lg bg-white w-full h-full relative p-4">
        <svg 
            ref={svgRef} 
            width={layout.width * zoom} 
            height={layout.height * zoom} 
            style={{ fontFamily: 'Inter, sans-serif' }}
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
      const iconSize = 56; // Larger icon
      const iconX = node.width / 2;
      const iconY = node.height / 2 - 15;
      
      return (
        <g transform={`translate(${node.x}, ${node.y})`}>
             {/* Invisible Hitbox for interactions later */}
             <rect
                width={node.width}
                height={node.height}
                fill="transparent"
             />
             
             {data.iconUrl ? (
                 <image 
                    href={data.iconUrl} 
                    x={iconX - iconSize / 2} 
                    y={5} 
                    width={iconSize} 
                    height={iconSize} 
                    style={{ imageRendering: 'pixelated' }}
                    filter="url(#icon-shadow)"
                 />
             ) : (
                <text x={iconX} y={35} fontSize="32" textAnchor="middle">
                   {isIngredient ? '🥕' : '🍳'}
                </text>
             )}

             <foreignObject x={0} y={iconSize + 10} width={node.width} height={node.height - iconSize - 10}>
                 <div className="flex items-start justify-center text-center h-full px-1">
                    <span className="text-[11px] leading-tight text-zinc-700 font-semibold line-clamp-3">
                        {data.text}
                    </span>
                 </div>
              </foreignObject>
        </g>
      );
  }
// ...

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