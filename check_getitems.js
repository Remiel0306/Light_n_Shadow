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
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'getchk',version:'1'}});
  await sleep(1000);
  const fs=require('fs');
  const summary=JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/graph_summary.json','utf8'));
  const nodes=Array.isArray(summary)?summary:(summary.nodes||summary.summary||[]);
  
  const gets=nodes.filter(n=>n.class==='K2Node_GetArrayItem');
  console.log(`Found ${gets.length} GetArrayItem nodes:`,gets.map(n=>`${n.id} (${n.title})`));
  
  // Export them in batches of 3
  let allT3d='';
  for(let i=0;i<gets.length;i+=3){
    const batch=gets.slice(i,i+3).map(n=>n.id);
    const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:batch});
    if(!r.raw) allT3d+=(r.t3d||r.content||'')+'\n';
    else console.log(`batch ${i} FAIL:`,r.raw);
    await sleep(200);
  }
  
  fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/get_items.t3d',allT3d);
  // Parse and show connections
  const objs=allT3d.split('Begin Object').filter(s=>s.includes('Name='));
  objs.forEach(obj=>{
    const nm=obj.match(/Name="([^"]+)"/)?.[1];
    const guid=obj.match(/NodeGuid=([A-F0-9]{32})/)?.[1];
    if(!nm) return;
    const links=obj.match(/LinkedTo=\([^)]+\)/g)||[];
    const dimMatch=obj.match(/DefaultValue="(\d+)"/);
    const dim=dimMatch?dimMatch[1]:'?';
    console.log(`\n${nm} (${guid?guid.substring(0,8):''}) index=${dim}:`);
    links.forEach(l=>console.log('  ',l.substring(0,180)));
  });
  
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
