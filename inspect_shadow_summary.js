const { spawn } = require('child_process');

const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let id = 1;
const bp = '/Game/BluePrint/BP_EnemyShadowLogic';
const send = (method, params) => mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) + '\n');

mcp.stdout.on('data', (d) => {
  for (const line of d.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.id === 1) {
        send('tools/call', { name: 'blueprint', arguments: { action: 'read_graph_summary', path: bp, assetPath: bp, graphName: 'EventGraph' } });
      } else if (r.id === 2) {
        const j = JSON.parse(r.result.content[0].text);
        const byTitle = (k) => j.nodes.filter((n) => n.title.includes(k)).map((n) => n.id);
        const keys = [
          'On Component Begin Overlap',
          'On Component End Overlap',
          'Event Tick',
          'For Each Loop',
          'Shadow Collision Change',
          'Line Trace By Channel',
          'Set Shadow farthest location',
          'Set Shadow colision distance',
          'Set Box Extent',
          'Get Active Ball',
          'Get Top',
          'Break Hit Result',
        ];
        for (const k of keys) {
          const ids = byTitle(k);
          if (ids.length) console.log(k, ids.join(','));
        }

        const focus = new Set();
        for (const k of [
          'Shadow Collision Change',
          'Line Trace By Channel',
          'Set Shadow farthest location',
          'Set Shadow colision distance',
          'Set Box Extent',
          'For Each Loop',
          'On Component Begin Overlap',
          'On Component End Overlap',
          'Break Hit Result',
          'Get Active Ball',
          'Get Top',
        ]) {
          for (const nid of byTitle(k)) focus.add(nid);
        }

        console.log('---ExecEdges---');
        for (const e of j.execEdges) {
          if (focus.has(e.from) || focus.has(e.to)) {
            console.log(`${e.from}.${e.fromPin} -> ${e.to}.${e.toPin}`);
          }
        }
        console.log('---DataEdges---');
        for (const e of j.dataEdges) {
          if (focus.has(e.from) || focus.has(e.to)) {
            console.log(`${e.from}.${e.fromPin} -> ${e.to}.${e.toPin}`);
          }
        }
        process.exit(0);
      }
    } catch (_) {}
  }
});

send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inspect-shadow', version: '1.0' } });

