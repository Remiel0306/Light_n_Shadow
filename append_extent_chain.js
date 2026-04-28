const { spawn } = require('child_process');

const BP = '/Game/BluePrint/BP_Enemy1';
const SET_DIST_ID = 'w6OeCkVSWJP2TLuIdKSyyg';

const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let reqId = 1;
let ids = {};

function send(method, params) {
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n');
}

function tool(args) {
  send('tools/call', { name: 'blueprint', arguments: args });
}

mcp.stdout.on('data', (data) => {
  for (const line of data.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const res = JSON.parse(line);
      if (res.id === 1) {
        // 1) add get distance
        tool({ action: 'add_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeClass: 'GetVar', nodeParams: { variableName: 'Shadow colision distance' }, posX: 3400, posY: 1400 });
      } else if (res.id === 2) {
        const p = JSON.parse(res.result.content[0].text); ids.getDist = p.nodeId;
        // 2) add make vector
        tool({ action: 'add_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeClass: 'CallFunction', nodeParams: { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, posX: 3620, posY: 1380 });
      } else if (res.id === 3) {
        const p = JSON.parse(res.result.content[0].text); ids.makeVec = p.nodeId;
        // 3) add get collider
        tool({ action: 'add_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeClass: 'GetVar', nodeParams: { variableName: 'ShadowCollider' }, posX: 3620, posY: 1550 });
      } else if (res.id === 4) {
        const p = JSON.parse(res.result.content[0].text); ids.getCol = p.nodeId;
        // 4) add set extent
        tool({ action: 'add_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeClass: 'CallFunction', nodeParams: { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, posX: 3870, posY: 1380 });
      } else if (res.id === 5) {
        const p = JSON.parse(res.result.content[0].text); ids.setExtent = p.nodeId;
        // 5) connect getDist -> makeVec.X
        tool({ action: 'connect_pins', path: BP, assetPath: BP, graphName: 'EventGraph', sourceNode: ids.getDist, sourcePin: 'Shadow colision distance', targetNode: ids.makeVec, targetPin: 'X' });
      } else if (res.id === 6) {
        // 6) set Y default
        tool({ action: 'set_node_property', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: ids.makeVec, pinName: 'Y', defaultValue: '20.0' });
      } else if (res.id === 7) {
        // 7) set Z default
        tool({ action: 'set_node_property', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: ids.makeVec, pinName: 'Z', defaultValue: '120.0' });
      } else if (res.id === 8) {
        // 8) connect makeVec -> setExtent.InBoxExtent
        tool({ action: 'connect_pins', path: BP, assetPath: BP, graphName: 'EventGraph', sourceNode: ids.makeVec, sourcePin: 'ReturnValue', targetNode: ids.setExtent, targetPin: 'InBoxExtent' });
      } else if (res.id === 9) {
        // 9) connect getCol -> setExtent.self
        tool({ action: 'connect_pins', path: BP, assetPath: BP, graphName: 'EventGraph', sourceNode: ids.getCol, sourcePin: 'ShadowCollider', targetNode: ids.setExtent, targetPin: 'self' });
      } else if (res.id === 10) {
        // 10) exec set_dist -> set_extent
        tool({ action: 'connect_pins', path: BP, assetPath: BP, graphName: 'EventGraph', sourceNode: SET_DIST_ID, sourcePin: 'then', targetNode: ids.setExtent, targetPin: 'execute' });
      } else if (res.id === 11) {
        // 11) update overlaps true
        tool({ action: 'set_node_property', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: ids.setExtent, pinName: 'bUpdateOverlaps', defaultValue: 'true' });
      } else if (res.id === 12) {
        // 12) compile
        tool({ action: 'compile', path: BP, assetPath: BP });
      } else if (res.id === 13) {
        console.log('APPEND_EXTENT_OK');
        process.exit(0);
      }
    } catch (e) {}
  }
});

send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'append-extent', version: '1.0' },
});

