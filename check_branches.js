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
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'branches',version:'1'}});
  await sleep(1000);
  const fs=require('fs');
  const summary=JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/graph_summary.json','utf8'));
  const nodes=Array.isArray(summary)?summary:(summary.nodes||summary.summary||[]);
  
  // Export all branch nodes in batches of 3
  const branches=nodes.filter(n=>n.class==='K2Node_IfThenElse');
  console.log(`Found ${branches.length} branch nodes`);
  
  let allT3d='';
  for(let i=0;i<branches.length;i+=3){
    const batch=branches.slice(i,i+3).map(n=>n.id);
    const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:batch});
    if(r.raw){console.log(`batch ${i}: FAIL`,r.raw);}
    else{
      const t=r.t3d||r.content||'';
      allT3d+=t+'\n';
      console.log(`batch ${i}: OK len=${t.length}`);
    }
    await sleep(300);
  }
  
  fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/all_branches.t3d',allT3d);
  console.log('Written all_branches.t3d total len=',allT3d.length);
  
  // Parse to find which branches have LinkedTo IsValid (slot check)
  const objs=allT3d.split('Begin Object').filter(s=>s.includes('Name='));
  objs.forEach(obj=>{
    const nameMatch=obj.match(/Name="([^"]+)"/);
    const guidMatch=obj.match(/NodeGuid=([A-F0-9]{32})/);
    if(!nameMatch) return;
    // Check if this branch is linked to IsValid (CallFunction with ReturnValue)
    const hasIsValid=obj.includes('K2Node_CallFunction_100')||obj.includes('K2Node_CallFunction_101');
    // Show all LinkedTo
    const links=obj.match(/LinkedTo=\([^)]+\)/g)||[];
    const execLinks=obj.match(/PinName="(execute|then|true|false|Condition)"[^)]*LinkedTo=\([^)]+\)/g)||[];
    if(links.length>0){
      console.log(`\n=== ${nameMatch[1]} (${guidMatch?guidMatch[1].substring(0,8):''}) ===`);
      execLinks.forEach(l=>console.log('  exec:',l.substring(0,200)));
      links.forEach(l=>console.log('  link:',l.substring(0,150)));
    }
  });
  
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
