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

const BP = '/Game/BluePrint/BP_EnemyShadowLogic';
const nodeHexIds = {
  getSlot0:  '206A3E344CF7114C033975AE04802007',
  getItem0:  '6FC93C7B4309D2158BAAF19C8632C48C',
  isValid0:  'B8A9499C49B0AE86ED9FCEA9D7A83D06',
  branch0:   '774EE7524452F2FF9BB15A99179B7812',
  arraySet0: 'DB280BC0413ACD516888E29D9B225B14',
};

(async()=>{
  const {rpc, bp, kill} = mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'pincheck2',version:'1'}});

  const nodeIds = Object.values(nodeHexIds).map(hexToB64url);
  const r = await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds});
  
  if(r.success){
    const t3d = r.t3d||'';
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/new_nodes.t3d', t3d);
    console.log('Saved, length:', t3d.length);
  } else {
    console.log('FAIL:', r.error);
  }
  
  kill();
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
