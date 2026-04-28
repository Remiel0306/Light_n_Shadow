const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });

const BP = '/Game/BluePrint/BP_Enemy1';
let msgId = 1;
const send = (method, params) => mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msgId++, method, params }) + '\n');

// Remaining connections to try:
// [1] Event Tick → For Each Loop (GetOverlappingActors is pure, skip it)
// [2] Cast output → Set Active Ball data pin (cast output pin name variations)
// [3] validate/compile

const CONNECTIONS = [
  // Event Tick → For Each Loop
  { sn: 'tDW6Xkxdn98iwmyZuC34pQ', sp: 'then', tn: 'jJbwdk7ygBo1U6mM9tSkqw', tp: 'execute' },
  { sn: 'tDW6Xkxdn98iwmyZuC34pQ', sp: 'then', tn: 'jJbwdk7ygBo1U6mM9tSkqw', tp: 'Exec' },
  // Cast output data → Set Active Ball
  { sn: '7LCVLUh1QHOTlt24LH7ovw', sp: 'As BP_LightBall', tn: 'fAYia0-XoUaljMqrTEP62Q', tp: 'Active Ball' },
  { sn: '7LCVLUh1QHOTlt24LH7ovw', sp: 'As BP Light Ball', tn: 'fAYia0-XoUaljMqrTEP62Q', tp: 'Active Ball' },
  { sn: '7LCVLUh1QHOTlt24LH7ovw', sp: 'AsObject', tn: 'fAYia0-XoUaljMqrTEP62Q', tp: 'Active Ball' },
];

let step = 0;
let tickConnected = false;
let castConnected = false;

const next = () => {
  if (step >= CONNECTIONS.length) {
    // validate
    console.log('\n=== Validate ===');
    send('tools/call', { name: 'blueprint', arguments: { action: 'validate', path: BP, assetPath: BP } });
    return;
  }
  const c = CONNECTIONS[step];
  console.log(`[${step}] ${c.sn.slice(0,8)}.${c.sp} → ${c.tn.slice(0,8)}.${c.tp}`);
  send('tools/call', {
    name: 'blueprint',
    arguments: {
      action: 'connect_pins', path: BP, assetPath: BP, graphName: 'EventGraph',
      sourceNode: c.sn, sourcePin: c.sp, targetNode: c.tn, targetPin: c.tp
    }
  });
};

let buf = '';
mcp.stdout.on('data', d => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.id === 1) { next(); return; }

      const connIdx = r.id - 2;
      if (connIdx < CONNECTIONS.length) {
        let ok = false;
        try {
          const body = JSON.parse(r.result.content[0].text);
          ok = body.success !== false;
          if (ok) console.log('  ✓ OK');
          else console.log('  ✗', body.error || JSON.stringify(body).slice(0,100));
        } catch (e) { console.log('  INFO:', JSON.stringify(r.result).slice(0,100)); }

        const c = CONNECTIONS[connIdx];
        // Skip further attempts for a group once succeeded
        if (ok) {
          if (connIdx <= 1) { tickConnected = true; step = 2; } // skip 2nd tick attempt
          else { castConnected = true; step = CONNECTIONS.length; } // done with cast
        } else {
          step++;
        }
        next();
      } else {
        // validate response
        try {
          const body = JSON.parse(r.result.content[0].text);
          console.log('Validate:', JSON.stringify(body).slice(0, 400));
        } catch (e) { console.log('Validate raw:', JSON.stringify(r.result).slice(0, 300)); }
        process.exit(0);
      }
    } catch (e) {}
  }
});

mcp.stderr.on('data', d => process.stderr.write(d));
send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix2', version: '1.0' } });
