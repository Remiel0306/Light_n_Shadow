const {spawn}=require('child_process');
function mkMCP(){
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},60000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {raw:(t||'').substring(0,600)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';
const nodes_to_check=[
  'K2Node_ComponentBoundEvent_0',
  'K2Node_IfThenElse_10','K2Node_IfThenElse_11',
  'K2Node_GetArrayItem_9',
  'K2Node_VariableGet_100','K2Node_CallFunction_100',
  'K2Node_CallArrayFunction_100',
  'K2Node_GetArrayItem_100','K2Node_CallFunction_101',
  'K2Node_CallArrayFunction_101',
];
(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'check',version:'1'}});
  console.log('=== Export BeginOverlap nodes ===');
  const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeNames:nodes_to_check});
  if(r.raw){console.log('RAW:',r.raw);}
  else if(r.success!==false){
    const t=JSON.stringify(r);
    // write to file
    require('fs').writeFileSync('D:/Unreal Engine/Light_n_Shadow/check_begin_overlap.t3d', r.t3d||r.content||t);
    console.log('Written to check_begin_overlap.t3d');
    // also print truncated
    const t3d=r.t3d||r.content||t;
    // Find exec connections
    const lines=t3d.split('\n');
    const execLines=lines.filter(l=>l.includes('exec')||l.includes('LinkedTo')&&l.includes('IfThenElse')||l.includes('ComponentBoundEvent')||l.includes('then')||l.includes('execute'));
    execLines.forEach(l=>console.log(l.trim().substring(0,150)));
  } else {
    console.log('FAIL:', r.error);
  }
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
