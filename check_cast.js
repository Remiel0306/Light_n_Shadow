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

// Graph summary IDs 
// Need to find DynamicCast_4 ID, IfThenElse_10, IfThenElse_11 IDs

(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'chain',version:'1'}});
  await sleep(1000);
  const fs=require('fs');
  
  // Get all node IDs from summary
  const summary=JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/graph_summary.json','utf8'));
  const nodes=Array.isArray(summary)?summary:(summary.nodes||summary.summary||[]);
  
  // Find DynamicCast nodes
  const casts=nodes.filter(n=>n.class&&n.class.includes('DynamicCast'));
  console.log('DynamicCast nodes:', casts.map(n=>JSON.stringify(n)));
  
  // Export them
  if(casts.length>0){
    const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:casts.map(n=>n.id)});
    if(!r.raw){
      const t=r.t3d||r.content||JSON.stringify(r);
      fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/cast_nodes.t3d',t);
      console.log('cast export OK len=',t.length);
      // Print exec-related pins only
      const lines=t.split('\n');
      lines.filter(l=>l.includes('PinName="then"')||l.includes('PinName="CastSucceeded"')||l.includes('PinName="CastFailed"')||l.includes('LinkedTo=')).forEach(l=>console.log(l.trim().substring(0,200)));
    } else {
      console.log('cast export FAIL:',r.raw);
    }
  }
  
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
