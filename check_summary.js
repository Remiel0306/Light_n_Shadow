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
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'summary',version:'1'}});
  await sleep(2000);
  
  const r=await bp({action:'read_graph_summary',path:BP,assetPath:BP,graphName:'EventGraph'});
  if(r.raw){console.log('FAIL:',r.raw);}
  else{
    const s=JSON.stringify(r,null,2);
    require('fs').writeFileSync('D:/Unreal Engine/Light_n_Shadow/graph_summary.json',s);
    console.log('OK, written to graph_summary.json, len=',s.length);
    // Find BeginOverlap related nodes
    if(r.nodes||r.summary){
      const nodes=r.nodes||r.summary||[];
      const relevant=JSON.stringify(nodes).split('\n').filter(l=>l.includes('ComponentBound')||l.includes('IfThenElse')||l.includes('CallArray')||l.includes('GetArray'));
      relevant.forEach(l=>console.log(l.substring(0,150)));
    }
  }
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
