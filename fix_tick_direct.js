const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });

const BP = '/Game/BluePrint/BP_Enemy1';
let msgId = 1;
const send = (method, params) => {
  const msg = JSON.stringify({ jsonrpc: '2.0', id: msgId++, method, params }) + '\n';
  mcp.stdin.write(msg);
};

// All the connections we need to establish
// Format: [sourceNode, sourcePin, targetNode, targetPin]
const CONNECTIONS = [
  // Event Tick → Get Overlapping Actors (exec)
  ['tDW6Xkxdn98iwmyZuC34pQ', 'then', 'qmO2kUBuQvZOW7Otzo-RWw', 'execute'],
  // Get Overlapping Actors → For Each Loop (exec)
  ['qmO2kUBuQvZOW7Otzo-RWw', 'then', 'jJbwdk7ygBo1U6mM9tSkqw', 'execute'],
  // Get CapsuleComponent → Get Overlapping Actors (target/self)
  ['gzqMJ0fdgKsBA9O9pYijNw', 'CapsuleComponent', 'qmO2kUBuQvZOW7Otzo-RWw', 'self'],
  // Cast To BP_LightBall (loop) → Set Active Ball (exec)
  ['7LCVLUh1QHOTlt24LH7ovw', 'then', 'fAYia0-XoUaljMqrTEP62Q', 'execute'],
  // Cast To BP_LightBall → Set Active Ball (data: output ref)
  ['7LCVLUh1QHOTlt24LH7ovw', 'As BP Light Ball', 'fAYia0-XoUaljMqrTEP62Q', 'Active Ball'],
];

let step = 0;
const results = [];

const next = () => {
  if (step === 0) {
    // init done → start first connection
    doConnect();
  }
};

const doConnect = () => {
  if (step >= CONNECTIONS.length) {
    // all done → compile
    console.log('\n=== Compiling ===');
    send('tools/call', {
      name: 'blueprint',
      arguments: { action: 'compile_blueprint', path: BP, assetPath: BP }
    });
    return;
  }
  const [sn, sp, tn, tp] = CONNECTIONS[step];
  console.log(`Connecting [${step}]: ${sn.slice(0,8)}.${sp} → ${tn.slice(0,8)}.${tp}`);
  send('tools/call', {
    name: 'blueprint',
    arguments: {
      action: 'connect_pins',
      path: BP,
      assetPath: BP,
      graphName: 'EventGraph',
      sourceNode: sn,
      sourcePin: sp,
      targetNode: tn,
      targetPin: tp,
    }
  });
};

let buf = '';
mcp.stdout.on('data', d => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.id === 1) {
        next();
      } else if (r.id > 1 && r.id <= CONNECTIONS.length + 1) {
        // connection response
        const idx = r.id - 2;
        let ok = false;
        try {
          const body = JSON.parse(r.result.content[0].text);
          ok = body.success !== false;
          if (!ok) console.log(`  WARN: ${JSON.stringify(body)}`);
          else console.log(`  OK`);
        } catch (e) {
          // may already be connected (idempotent)
          console.log(`  INFO: ${JSON.stringify(r.result).slice(0,120)}`);
        }
        results.push({ idx, ok });
        step++;
        doConnect();
      } else {
        // compile response
        try {
          const body = JSON.parse(r.result.content[0].text);
          console.log('Compile:', JSON.stringify(body).slice(0, 300));
        } catch (e) {
          console.log('Compile result:', JSON.stringify(r.result).slice(0, 300));
        }
        console.log('\nAll done. Connections attempted:', results.length);
        process.exit(0);
      }
    } catch (e) {}
  }
});

mcp.stderr.on('data', d => process.stderr.write(d));

send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix_tick', version: '1.0' } });
