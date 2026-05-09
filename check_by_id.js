const {spawn}=require('child_process');
function mkMCP(){
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},90000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {raw:(t||'').substring(0,800)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}
const BP='/Game/BluePrint/BP_Enemy1';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'expid',version:'1'}});
  await sleep(1000);
  
  const fs=require('fs');
  // Try export by nodeIds (hex GUIDs decoded from base64url IDs)
  // kCeAXku2Xz37OKmQVsleuQ = BeginOverlap event
  // base64url decode: 90 A7 80 5E 2D B6 CF 3D F9 D9 A8 D0 56 96 96 AB... let me just try
  // Try by nodeName with actual T3D format
  
  // First try: export by nodeId using the base64url id from summary
  let r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:['kCeAXku2Xz37OKmQVsleuQ']});
  if(!r.raw){
    const t=r.t3d||r.content||JSON.stringify(r);
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/be_by_id.t3d',t);
    console.log('by nodeIds OK, len=',t.length);
  } else {
    console.log('by nodeIds FAIL:',r.raw);
    // Try by nodeId (singular)
    await sleep(500);
    r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:'kCeAXku2Xz37OKmQVsleuQ'});
    if(!r.raw){
      const t=r.t3d||r.content||JSON.stringify(r);
      fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/be_by_id.t3d',t);
      console.log('by nodeId OK, len=',t.length);
    } else {
      console.log('by nodeId FAIL:',r.raw);
    }
  }
  
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
