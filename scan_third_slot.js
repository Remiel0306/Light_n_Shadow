const { spawn } = require('child_process');
const fs = require('fs');

function mk() {
  const m = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
  let id = 1;
  const wait = new Map();
  let buf = '';

  m.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const cb = wait.get(msg.id);
        if (cb) {
          wait.delete(msg.id);
          cb(msg);
        }
      } catch {}
    }
  });

  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const reqId = id++;
      const t = setTimeout(() => {
        wait.delete(reqId);
        reject(new Error(`timeout ${method}`));
      }, 90000);
      wait.set(reqId, (resp) => {
        clearTimeout(t);
        resolve(resp);
      });
      m.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\n');
    });
  }

  async function call(name, args) {
    const r = await rpc('tools/call', { name, arguments: args });
    const t = r?.result?.content?.[0]?.text || '';
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t };
    }
  }

  return { rpc, call, kill: () => m.kill() };
}

function parseSetNodes(t3d) {
  const objs = t3d
    .split('Begin Object')
    .filter((x) => x.includes('Class=/Script/BlueprintGraph.K2Node_CallArrayFunction') && x.includes('Set Array Elem'));
  const out = [];
  for (const o of objs) {
    const name = (o.match(/Name="([^"]+)"/) || [])[1] || 'UNKNOWN';
    const index = (o.match(/PinName="Index"[\s\S]*?DefaultValue="([^"]+)"/) || [])[1] || '?';
    const execFrom = (o.match(/PinName="execute"[\s\S]*?LinkedTo=\(([^)]*)\)/) || [])[1] || 'NONE';
    const itemFrom = (o.match(/PinName="Item"[\s\S]*?LinkedTo=\(([^)]*)\)/) || [])[1] || 'NONE';
    const arrayFrom = (o.match(/PinName="TargetArray"[\s\S]*?LinkedTo=\(([^)]*)\)/) || [])[1] || 'NONE';
    out.push({ name, index, execFrom, itemFrom, arrayFrom });
  }
  return out;
}

async function main() {
  const BP = '/Game/BluePrint/BP_EnemyShadowLogic';
  const { rpc, call, kill } = mk();
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scan-third-slot', version: '1' },
  });

  const s = await call('blueprint', {
    action: 'read_graph_summary',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
  });

  if (s.success === false) {
    console.log('SUMMARY_FAIL', s.error || s.raw || 'unknown');
    kill();
    return;
  }

  const nodes = Array.isArray(s) ? s : s.nodes || s.summary || [];
  const setNodes = nodes.filter((n) => n.class === 'K2Node_CallArrayFunction' && (n.title || '').includes('Set Array Elem'));
  const branches = nodes.filter((n) => n.class === 'K2Node_IfThenElse');
  const valids = nodes.filter((n) => n.class === 'K2Node_CallFunction' && (n.title || '').toLowerCase().includes('is valid'));
  const begins = nodes.filter((n) => n.class === 'K2Node_ComponentBoundEvent' && (n.title || '').includes('Begin Overlap'));

  console.log('Set Array Elem node count:', setNodes.length);
  console.log('Branch node count:', branches.length);
  console.log('IsValid node count:', valids.length);
  console.log('BeginOverlap node count:', begins.length);

  // Keep export tiny to avoid bridge timeouts.
  const ids = [...new Set(setNodes.map((n) => n.id))];
  const ex = await call('blueprint', {
    action: 'export_nodes_t3d',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeIds: ids,
  });

  if (ex.success === false || ex.raw) {
    console.log('EXPORT_FAIL', ex.error || ex.raw || 'unknown');
    kill();
    return;
  }

  const t3d = ex.t3d || ex.content || '';
  fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/scan_third_slot.t3d', t3d);
  const parsed = parseSetNodes(t3d);
  for (const p of parsed) {
    console.log(
      `SET ${p.name} INDEX=${p.index} EXEC_FROM=[${p.execFrom}] ITEM_FROM=[${p.itemFrom}] ARRAY_FROM=[${p.arrayFrom}]`
    );
  }

  kill();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
