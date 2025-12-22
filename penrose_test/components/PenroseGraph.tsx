"use client";

import { useEffect, useState } from "react";
import { compileTrio, optimize, showError, toSVG } from "@penrose/core";

export default function PenroseGraph() {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function runPenrose() {
      const domain = `
        type Node
        type Edge
        predicate Connects(Node, Node, Edge)
      `;

      const substance = `
        Node A, B, C, D, E
        Edge e1, e2, e3, e4, e5, e6

        Connects(A, B, e1)
        Connects(B, C, e2)
        Connects(C, D, e3)
        Connects(D, E, e4)
        Connects(E, A, e5)
        Connects(A, C, e6)
      `;

      const style = `
        canvas {
          width = 600
          height = 600
        }

        forall Node n {
          shape n.icon = Circle {
            r: 20.0
            fillColor: #3498db
            strokeColor: #2980b9
            strokeWidth: 2.0
          }
          shape n.text = Text {
            string: n.label
            fillColor: #ffffff
            center: n.icon.center
            fontSize: "12px"
            fontFamily: "sans-serif"
          }
          ensure onCanvas(n.icon, 600, 600)
          layer n.text above n.icon
        }

        forall Node u; Node v; Edge e
        where Connects(u, v, e) {
          shape e.line = Line {
            start: u.icon.center
            end: v.icon.center
            strokeColor: #333333
            strokeWidth: 2.0
          }
          layer e.line below u.icon
          layer e.line below v.icon

          -- Attractive spring force
          encourage equal(vdist(u.icon.center, v.icon.center), 150.0)
        }

        forall Node u; Node v {
          -- Repulsive force (inverse distance)
          encourage repelPt(200.0, u.icon.center, v.icon.center)
          
          ensure disjoint(u.icon, v.icon, 5.0)
        }
      `;

      try {
        console.log("Compiling Trio...");
        const result = await compileTrio({
          domain,
          substance,
          style,
          variation: "graph-layout",
        });

        if (result.isErr()) {
          console.error("Compilation failed:", result.error);
          setError(showError(result.error));
          return;
        }

        let state = result.value;
        console.log("Compilation successful. State obtained.");
        
        // Run optimization
        console.log("Optimizing...");
        const optimizedRes = optimize(state);
        if (optimizedRes.isErr()) {
          console.error("Optimization failed:", optimizedRes.error);
          setError(showError(optimizedRes.error));
          return;
        }
        state = optimizedRes.value;
        console.log("Optimization successful.");

        // Render to SVG
        console.log("Rendering to SVG...");
        const svg = await toSVG(state, async () => undefined, "penrose-graph");
        
        let svgString = svg.outerHTML;
        // Ensure width and height are set if missing, based on canvas size
        if (!svg.hasAttribute("width")) {
            svgString = svgString.replace("<svg ", '<svg width="600" height="600" ');
        }
        
        // Fix viewBox to center the origin (0,0)
        // Penrose generates viewBox="0 0 600 600" but shapes are centered at (0,0)
        svgString = svgString.replace('viewBox="0 0 600 600"', 'viewBox="-300 -300 600 600"');
        
        console.log("SVG generated:", svgString);
        setSvgContent(svgString);
      } catch (e: any) {
        setError(e.message || String(e));
        console.error("Penrose Error:", e);
      }

    }

    runPenrose();
  }, []);

  if (error) {
    return (
      <div className="p-4 border border-red-500 bg-red-50 rounded max-w-2xl mx-auto mt-8">
        <h3 className="font-bold text-red-700">Penrose Error</h3>
        <pre className="whitespace-pre-wrap text-sm text-red-600 mt-2">{error}</pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 min-h-screen bg-gray-50">
      <h2 className="text-3xl font-bold mb-2">Penrose Graph Layout</h2>
      <p className="mb-6 text-gray-600">
        Constraint-based graph layout with node repulsion.
      </p>
      {svgContent ? (
        <div className="flex flex-col items-center w-full">
          <div
            className="border rounded-xl shadow-lg bg-white p-4"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
          <details className="mt-4 w-full max-w-2xl">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Debug: SVG Source</summary>
            <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-40">
              {svgContent}
            </pre>
          </details>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-4 text-blue-600 mt-12">
          <svg className="animate-spin h-10 w-10" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-lg font-medium">Optimizing graph layout...</span>
        </div>
      )}
    </div>
  );
}
