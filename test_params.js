const {spawn}=require('child_process');
const fs=require('fs');

function toHex(b64url) {
  const b64 = b64url.replace(/-/g,'+').replace(/_/g,'/');
  const padded = b64 + '=='.substring(0,(4 - b64.length % 4) % 4);
  return Buffer.from(padded,'base64').toString('hex').toUpperCase();
}

function mkMCP() {
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},50000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,300)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}

const BP = '/Game/BluePrint/BP_Enemy1';

(async()=>{
  // ===== Single connection for all operations =====
  const {rpc, bp, kill} = mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fix3',version:'1'}});
  
  // ===== Step 0: Check what delete_node actually accepts =====
  // Try with nodeName (T3D name format)
  console.log('\n=== Testing delete_node with nodeName ===');
  let r = await bp({action:'delete_node',path:BP,assetPath:BP,graphName:'EventGraph',
    nodeName:'K2Node_MacroInstance_1'});
  console.log('delete by name:', r.success?'OK':r.error);
  
  // Try with nodeId in hex format  
  r = await bp({action:'delete_node',path:BP,assetPath:BP,graphName:'EventGraph',
    nodeId:'197673F249C5B612EC0BC79AA7C8FB42'});
  console.log('delete by hex id:', r.success?'OK':r.error);
  
  // Try without graphName
  r = await bp({action:'delete_node',path:BP,assetPath:BP,
    nodeId:'197673F249C5B612EC0BC79AA7C8FB42'});
  console.log('delete without graphName:', r.success?'OK':r.error);
  
  // Try with just nodeName
  r = await bp({action:'delete_node',path:BP,assetPath:BP,
    nodeName:'K2Node_MacroInstance_1'});
  console.log('delete without graphName+name:', r.success?'OK':r.error);

  // ===== Step 0b: Check connect_pins signature =====
  console.log('\n=== Testing connect_pins ===');
  // Check what parameter names it actually needs by looking at schema
  // Try with nodeId format for connect_pins
  // First get two known nodes from add_node to test
  const testBranch = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
    nodeClass:'K2Node_IfThenElse',posX:9999,posY:9999});
  console.log('test branch added:', testBranch.nodeId);
  
  if(testBranch.nodeId) {
    // Try different parameter names for connect_pins
    r = await bp({action:'connect_pins',path:BP,assetPath:BP,graphName:'EventGraph',
      sourceNodeId:testBranch.nodeId, sourcePinName:'then',
      targetNodeId:testBranch.nodeId, targetPinName:'execute'});
    console.log('connect_pins (sourceNodeId):', r.success?'OK':r.error);
    
    r = await bp({action:'connect_pins',path:BP,assetPath:BP,graphName:'EventGraph',
      sourceNode:testBranch.nodeId, sourcePin:'then',
      targetNode:testBranch.nodeId, targetPin:'execute'});
    console.log('connect_pins (sourceNode):', r.success?'OK':r.error);
    
    // Clean up test node
    r = await bp({action:'delete_node',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:testBranch.nodeId});
    console.log('delete test node (nodeId hex from add_node):', r.success?'OK':r.error);
  }
  
  kill();
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
