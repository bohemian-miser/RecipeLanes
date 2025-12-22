import { compileTrio, optimize, toSVG, showError } from '@penrose/core';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!DOCTYPE html><p>Hello world</p>`);
global.document = dom.window.document;
global.window = dom.window;

async function run() {

  console.log("Starting...");
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
      -- Repulsive force
      encourage repelPt(200.0, u.icon.center, v.icon.center)
      
      ensure disjoint(u.icon, v.icon, 5.0)
    }
  `;

  console.log("Compiling...");
  const result = await compileTrio({
    domain,
    substance,
    style,
    variation: "graph-layout",
  });

  if (result.isErr()) {
    console.log("Compilation Error:", showError(result.error));
    return;
  }
  
  console.log("Compiled. Optimizing...");
  let state = result.value;
  
  // optimize returns a Result<State, PenroseError> (or similar depending on version)
  // based on my previous fix in the TSX file, I treated it as returning a Result.
  // Let's verify what it actually returns.
  
  try {
    const optResult = optimize(state);
    // console.log("Optimize result keys:", Object.keys(optResult));
    
    if (optResult.isErr && optResult.isErr()) {
        console.log("Optimization Error:", showError(optResult.error));
        return;
    }

    // In some versions optimize returns the state directly or a Result.
    // If it has .value, it's a Result.
    if ('value' in optResult) {
        state = optResult.value;
    } else {
        state = optResult;
    }

        console.log("Optimized. Generating SVG...");

        const svg = await toSVG(state, async () => undefined, "penrose-graph");

        console.log("SVG generated. Length:", svg.outerHTML.length);

        console.log("SVG Start:", svg.outerHTML.substring(0, 200));

        console.log("SVG End:", svg.outerHTML.substring(svg.outerHTML.length - 100));

        

        // Check width/height/viewBox

        console.log("Width:", svg.getAttribute("width"));

        console.log("Height:", svg.getAttribute("height"));

        console.log("ViewBox:", svg.getAttribute("viewBox"));

      } catch (e) {

        console.error("Crash during optimization/SVG generation:", e);

      }

    }

    

    run();

    

