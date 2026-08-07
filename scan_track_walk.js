const fs = require("fs");
const graph = JSON.parse(
  fs.readFileSync(
    "D:/Unreal Engine/Light_n_Shadow/scan_after_track3_full.json",
    "utf8"
  )
);
const nodes = graph.nodes || [];
const byId = new Map(nodes.map((n) => [n.id, n]));

function pinConnections(node, pinName) {
  const pin = (node.pins || []).find((p) => p.name === pinName);
  if (!pin) return [];
  // connections may be in linkedTo / connections / linkedPins
  if (Array.isArray(pin.linkedTo)) return pin.linkedTo;
  if (Array.isArray(pin.connections)) return pin.connections;
  return [];
}

// Discover connection format from a sample connected pin
let sample = null;
for (const n of nodes) {
  for (const p of n.pins || []) {
    if (p.connected && (p.linkedTo || p.connections || p.linkedToNodeId)) {
      sample = { title: n.title, pin: p };
      break;
    }
  }
  if (sample) break;
}

// Build adjacency from whatever format exists
const execOut = new Map(); // nodeId -> [{pin, toId, toPin}]
const dataInto = new Map();

function addExec(fromId, pin, toId, toPin) {
  if (!execOut.has(fromId)) execOut.set(fromId, []);
  execOut.get(fromId).push({ pin, toId, toPin });
}

for (const n of nodes) {
  for (const p of n.pins || []) {
    const links =
      p.linkedTo ||
      p.connections ||
      p.links ||
      (p.linkedNodeId ? [{ nodeId: p.linkedNodeId, pin: p.linkedPinName }] : null);
    if (!links) continue;
    const arr = Array.isArray(links) ? links : [links];
    for (const l of arr) {
      const toId = l.nodeId || l.node || l.id || l.toNodeId;
      const toPin = l.pinName || l.pin || l.toPin || "";
      if (!toId) continue;
      if (p.direction === "Output" && p.type === "exec") {
        addExec(n.id, p.name, toId, toPin);
      }
    }
  }
}

// If no links found, try graph.wires / connections top-level
const wires = graph.wires || graph.connections || graph.links || [];
for (const w of wires) {
  const fromId = w.fromNodeId || w.sourceNode || w.from;
  const toId = w.toNodeId || w.targetNode || w.to;
  const fromPin = w.fromPin || w.sourcePin || "";
  const toPin = w.toPin || w.targetPin || "";
  const fromNode = byId.get(fromId);
  const fromPinObj = fromNode && (fromNode.pins || []).find((p) => p.name === fromPin);
  if (fromPinObj && fromPinObj.type === "exec") {
    addExec(fromId, fromPin, toId, toPin);
  }
}

const after = nodes.filter((n) => /After Track Arrived/i.test(n.title || ""));
const grabRelated = nodes.filter((n) =>
  /GrabCount|MaxGrab|LastGrab|After Track|Phase 2 Try|Track Loop|Random Float|Start Follow|Request Kill|IsFollowing|Phase2Paused/i.test(
    n.title || ""
  )
);

// BFS from After Track Arrived custom event nodes
function walk(startId, maxDepth = 40) {
  const steps = [];
  const q = [{ id: startId, depth: 0, via: "start" }];
  const seen = new Set();
  while (q.length) {
    const { id, depth, via } = q.shift();
    if (seen.has(id) || depth > maxDepth) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    const outs = execOut.get(id) || [];
    steps.push({
      depth,
      via,
      id,
      title: n.title,
      class: n.class,
      outs: outs.map((o) => ({ pin: o.pin, to: (byId.get(o.toId) || {}).title })),
      pinSummary: (n.pins || [])
        .filter((p) => p.direction === "Input" && p.type !== "exec")
        .map((p) => ({
          name: p.name,
          type: p.type,
          defaultValue: p.defaultValue,
          connected: p.connected,
        })),
    });
    for (const o of outs) q.push({ id: o.toId, depth: depth + 1, via: o.pin });
  }
  return steps;
}

const flows = {};
for (const n of after) {
  if (/Custom Event/i.test(n.title)) {
    flows[n.title] = walk(n.id);
  }
}

// Also dump pin schema of first connected node for debugging if walk empty
const schemaSample = nodes.slice(0, 3).map((n) => ({
  title: n.title,
  keys: Object.keys(n),
  pinKeys: (n.pins || [])[0] && Object.keys(n.pins[0]),
  pin0: (n.pins || [])[0],
}));

fs.writeFileSync(
  "D:/Unreal Engine/Light_n_Shadow/scan_after_track4.json",
  JSON.stringify(
    {
      nodeCount: nodes.length,
      topKeys: Object.keys(graph),
      execEdgeCount: [...execOut.values()].reduce((a, b) => a + b.length, 0),
      wireCount: Array.isArray(wires) ? wires.length : 0,
      schemaSample,
      afterTitles: after.map((n) => n.title),
      grabRelatedTitles: [...new Set(grabRelated.map((n) => n.title))],
      flows,
      sampleConnectedPin: sample,
    },
    null,
    2
  )
);
console.log("done", {
  nodes: nodes.length,
  execEdges: [...execOut.values()].reduce((a, b) => a + b.length, 0),
  after: after.length,
});
