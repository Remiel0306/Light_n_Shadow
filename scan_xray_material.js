const fs = require('fs');
const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const MAT = '/Game/Material/XRayVision/M_XRayVIsion';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p, ms = 120000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    pending.set(i, (m) => { clearTimeout(t); res(m); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) cb(msg); } catch (_) {}
  }
});
function parse(res) {
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return { raw: res?.result?.content?.[0]?.text }; }
}
async function mat(action, extra = {}) {
  return parse(await rpc('tools/call', { name: 'material', arguments: { action, assetPath: MAT, path: MAT, ...extra } }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scan_xray2' } });

  const read = await mat('read_material');
  const exprs = read.expressions || [];

  const report = {
    material: MAT,
    expressionCount: exprs.length,
    expressions: exprs.map((e) => ({
      index: e.index,
      class: e.class,
      desc: e.description,
      outputs: e.outputs,
      inputs: e.inputs,
    })),
    emissiveConnection: null,
    xrayOn: [],
    lerps: [],
    analysis: [],
  };

  for (const e of exprs) {
    const d = (e.description || '').toLowerCase();
    const c = e.class || '';
    if (/xrayon/i.test(e.description || '')) {
      report.xrayOn.push(e);
    }
    if (/lerp|linearinterpolate/i.test(c) || /lerp/i.test(d)) {
      report.lerps.push(e);
    }
    if (/emissive/i.test(e.connectedProperties || '') || e.connectedToEmissive) {
      report.emissiveConnection = e;
    }
  }

  // parse inputs for connections
  for (const e of exprs) {
    const ins = e.inputs || {};
    for (const [pin, info] of Object.entries(ins)) {
      if (!info || info.index === undefined) return;
    }
  }

  // read_material may include connection info in inputs as {index, outputIndex}
  function findExpr(idx) {
    return exprs.find((e) => e.index === idx);
  }

  function trace(idx, pin, depth = 0) {
    if (idx === undefined || idx < 0 || depth > 12) return null;
    const e = findExpr(idx);
    if (!e) return `expr#${idx}`;
    const name = `${e.description || e.class} [#${idx}]`;
    if (depth > 8) return name;
    const ins = e.inputs || {};
    const childPins = [];
    for (const [p, info] of Object.entries(ins)) {
      if (info && typeof info.index === 'number' && info.index >= 0) {
        childPins.push(`${p}<=${trace(info.index, p, depth + 1)}`);
      }
    }
    return childPins.length ? `${name} {${childPins.join(', ')}}` : name;
  }

  // find emissive root - expression connected to emissive
  for (const e of exprs) {
    if (e.connectedProperties && /emissive/i.test(JSON.stringify(e.connectedProperties))) {
      report.emissiveConnection = { from: e.index, desc: e.description, trace: trace(e.index, 'emissive', 0) };
    }
  }

  // also check material properties in read output
  if (read.properties) {
    report.properties = read.properties;
    const em = read.properties.emissive || read.properties.EmissiveColor;
    if (em && em.expressionIndex !== undefined) {
      report.emissiveConnection = {
        expressionIndex: em.expressionIndex,
        trace: trace(em.expressionIndex, 'emissive', 0),
      };
    }
  }

  for (const e of exprs) {
    if (/collectionparameter/i.test(e.class) && /xray/i.test(e.description || '')) {
      const outs = [];
      for (const other of exprs) {
        const ins = other.inputs || {};
        for (const [pin, info] of Object.entries(ins)) {
          if (info && info.index === e.index) {
            outs.push({ to: other.description, toIndex: other.index, pin });
          }
        }
      }
      report.xrayOn.push({ ...e, drives: outs });
    }
    if (/lerp/i.test(e.class)) {
      const ins = e.inputs || {};
      report.lerps.push({
        index: e.index,
        desc: e.description,
        A: ins.A || ins.a,
        B: ins.B || ins.b,
        Alpha: ins.Alpha || ins.alpha,
        A_trace: ins.A?.index >= 0 ? trace(ins.A.index, 'A', 0) : null,
        B_trace: ins.B?.index >= 0 ? trace(ins.B.index, 'B', 0) : null,
        Alpha_trace: ins.Alpha?.index >= 0 ? trace(ins.Alpha.index, 'Alpha', 0) : ins.Alpha?.constant,
      });
    }
  }

  // export graph if available
  try {
    report.export = await mat('export_material_graph');
  } catch (_) {}

  if (report.lerps.length) {
    const final = report.lerps[report.lerps.length - 1];
    report.analysis.push(`Final-ish Lerp #${final.index}: Alpha=${JSON.stringify(final.Alpha)}, A=${final.A_trace}, B=${final.B_trace}`);
    if (final.Alpha_trace && /XRayOn/i.test(String(final.Alpha_trace))) {
      report.analysis.push('XRayOn drives Lerp Alpha: 1=use B, 0=use A');
    }
    if (final.B_trace && /100|Constant/i.test(String(final.B_trace)) && !/XRay|CustomDepth/i.test(String(final.B_trace))) {
      report.analysis.push('B is likely Constant 100 - when XRay ON, darkening on A is discarded');
    }
  }

  fs.writeFileSync('scan_xray_material_report.json', JSON.stringify({ read: { expressionCount: exprs.length }, report }, null, 2));

  console.log('Expressions:', exprs.length);
  console.log('\nEmissive:', JSON.stringify(report.emissiveConnection, null, 2));
  console.log('\n=== Lerps ===');
  report.lerps.forEach((l) => {
    console.log(`\n#${l.index} ${l.desc}`);
    console.log('  Alpha:', l.Alpha_trace || l.Alpha);
    console.log('  A:', l.A_trace);
    console.log('  B:', l.B_trace);
  });
  console.log('\n=== XRayOn ===');
  report.xrayOn.forEach((x) => {
    console.log(x.description, 'drives:', x.drives);
  });
  console.log('\nAnalysis:', report.analysis.join('\n'));
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
