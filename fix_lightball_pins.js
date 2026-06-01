const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/Player/BP_LightBall';
const MAT_PATH = '/Game/Material/XRayVision/M_LightBall_XRayOverlay.M_LightBall_XRayOverlay';
const MPC = '/Game/Material/MPC_XRayVision.MPC_XRayVision';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), 120000);
    pending.set(i, (msg) => { clearTimeout(t); res(msg); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) { pending.delete(msg.id); cb(msg); } } catch (_) {}
  }
});
const parse = (r) => { try { return JSON.parse(r?.result?.content?.[0]?.text); } catch { return { raw: r?.result?.content?.[0]?.text }; } };
const bp = async (a) => parse(await rpc('tools/call', { name: 'blueprint', arguments: { path: BP, assetPath: BP, ...a } }));
const editor = async (a) => parse(await rpc('tools/call', { name: 'editor', arguments: a }));

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pins' } });

  console.log(await editor({ action: 'set_property', path: MAT_PATH, propertyName: 'bDisableDepthTest', value: true }));
  console.log(await editor({ action: 'set_property', path: MAT_PATH, propertyName: 'TwoSided', value: true }));

  const g = await bp({ action: 'read_graph', graphName: 'EventGraph' });
  const nodes = g.nodes || [];
  console.log('nodes', nodes.length);
  for (const n of nodes) {
    if (n.class === 'K2Node_CallFunction' || n.class === 'K2Node_Event') console.log(n.id, n.class, n.title);
  }

  const byTitle = (t) => nodes.find((n) => (n.title || '').includes(t))?.id;
  const ids = {
    bp: byTitle('BeginPlay'),
    tk: byTitle('Tick'),
    cr: byTitle('CreateDynamicMaterialInstance'),
    sm: byTitle('SetMaterial'),
    sv: nodes.find((n) => n.class === 'K2Node_VariableSet')?.id,
    gm: byTitle('GetScalarParameterValue'),
    sg: nodes.filter((n) => (n.title || '').includes('SetScalarParameterValue')).pop()?.id,
    gv: nodes.find((n) => n.class === 'K2Node_VariableGet' && (n.title || '').includes('XRayOverlayMID'))?.id,
    ov: nodes.find((n) => n.class === 'K2Node_VariableGet' && (n.title || '').includes('XRayOverlay') && !(n.title || '').includes('MID'))?.id,
  };
  console.log(ids);

  async function tryAll(a, b) {
    const na = nodes.find((n) => n.id === a);
    const nb = nodes.find((n) => n.id === b);
    if (!na?.pins || !nb?.pins) return false;
    for (const sp of na.pins) {
      if (sp.direction !== 'Output' && sp.direction !== 'EGPD_Output') continue;
      for (const tp of nb.pins) {
        if (tp.direction !== 'Input' && tp.direction !== 'EGPD_Input') continue;
        const r = await bp({
          action: 'connect_pins',
          graphName: 'EventGraph',
          sourceNode: a,
          sourcePin: sp.name,
          targetNode: b,
          targetPin: tp.name,
        });
        if (r.success !== false) {
          console.log('OK', sp.name, '->', tp.name);
          return true;
        }
      }
    }
    return false;
  }

  if (ids.bp && ids.cr) await tryAll(ids.bp, ids.cr);
  if (ids.cr && ids.sm) await tryAll(ids.cr, ids.sm);
  if (ids.sm && ids.sv) await tryAll(ids.sm, ids.sv);
  if (ids.ov && ids.sm) await tryAll(ids.ov, ids.sm);
  if (ids.cr && ids.sm) await tryAll(ids.cr, ids.sm);
  if (ids.cr && ids.sv) await tryAll(ids.cr, ids.sv);
  if (ids.tk && ids.gm) await tryAll(ids.tk, ids.gm);
  if (ids.gm && ids.sg) await tryAll(ids.gm, ids.sg);
  if (ids.gv && ids.sg) await tryAll(ids.gv, ids.sg);
  if (ids.gm && ids.sg) await tryAll(ids.gm, ids.sg);

  await bp({ action: 'compile' });
  console.log('validate', await bp({ action: 'validate' }));
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); });
