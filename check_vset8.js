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
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'vset8',version:'1'}});
  await sleep(1000);
  const fs=require('fs');
  const summary=JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/graph_summary.json','utf8'));
  const nodes=Array.isArray(summary)?summary:(summary.nodes||summary.summary||[]);
  
  const vsets=nodes.filter(n=>n.class&&n.class.includes('VariableSet'));
  console.log('VariableSet nodes:', vsets.map(n=>n.title));
  
  const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:vsets.map(n=>n.id)});
  if(r.raw){console.log('FAIL:',r.raw);}
  else{
    const t=r.t3d||r.content||'';
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/varsets.t3d',t);
    // Find VariableSet_8 exec connections
    const objs=t.split('Begin Object').filter(s=>s.includes('Name='));
    objs.forEach(obj=>{
      const nm=obj.match(/Name="([^"]+)"/)?.[1];
      if(!nm) return;
      const links=obj.match(/LinkedTo=\([^)]+\)/g)||[];
      if(links.length>0){
        console.log(`\n=== ${nm} ===`);
        links.forEach(l=>console.log('  ',l.substring(0,150)));
      }
    });
  }
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
