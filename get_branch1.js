const {spawn}=require('child_process');
const fs=require('fs');

function mkMCP() {
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},60000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,300)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}

function hexToB64url(hex) {
  return Buffer.from(hex, 'hex').toString('base64url');
}

const BP = '/Game/BluePrint/BP_Enemy1';
// branch1 hex GUID from fix_final.js
const BRANCH1_HEX = '67FD8A9148F4155E965F7B83B2E9E7D1';

(async()=>{
  const {rpc, bp, kill} = mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'getbranch1',version:'1'}});
  
  // Export branch1 to get pin IDs
  const r = await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',
    nodeIds:[hexToB64url(BRANCH1_HEX)]});
  if(r.success){
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/branch1_pins.t3d', r.t3d||'');
    console.log('branch1 T3D:', r.t3d);
  } else console.log('FAIL:', r.error);
  
  kill(); process.exit(0);
})();
