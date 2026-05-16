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
const BP='/Game/BluePrint/BP_EnemyShadowLogic';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'chk4',version:'1'}});
  await sleep(1500);
  
  // Export just the ComponentBoundEvent and one Branch node
  let r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeNames:['K2Node_ComponentBoundEvent_0']});
  const fs=require('fs');
  if(r.raw){console.log('BoundEvent FAIL:',r.raw);}
  else{
    const t=r.t3d||r.content||'';
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/bound_event.t3d',t);
    console.log('BoundEvent OK len=',t.length);
    // Show pin lines
    t.split('\n').filter(l=>l.includes('CustomProperties Pin')||l.includes('LinkedTo')).slice(0,20).forEach(l=>console.log(l.trim().substring(0,200)));
  }
  
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
