const {spawn}=require('child_process');
function mkMCP(){
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},90000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {raw:(t||'').substring(0,600)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}
const BP='/Game/BluePrint/BP_EnemyShadowLogic';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'check3',version:'1'}});
  await sleep(1000);
  
  // Just check the 3 key exec nodes in small batch
  const batch1=['K2Node_ComponentBoundEvent_0','K2Node_IfThenElse_10','K2Node_IfThenElse_11'];
  let r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeNames:batch1});
  if(r.raw){console.log('batch1 FAIL:',r.raw);}
  else{
    const t3d=r.t3d||r.content||'';
    require('fs').writeFileSync('D:/Unreal Engine/Light_n_Shadow/check_exec.t3d',t3d);
    console.log('batch1 OK, len=',t3d.length);
  }
  
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
