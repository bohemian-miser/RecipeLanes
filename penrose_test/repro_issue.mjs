import { compileTrio, showError } from '@penrose/core';

async function run() {
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

  const result = await compileTrio({
    domain,
    substance,
    style,
    variation: "graph-layout",
  });

  if (result.isErr()) {
    console.log("Compilation Error:");
    console.log(showError(result.error));
  } else {
    console.log("Compilation Success!");
  }
}

run();
