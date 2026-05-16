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

async function connect(bp,src,sp,tgt,tp){
  const r=await bp({action:'connect_pins',path:BP,assetPath:BP,graphName:'EventGraph',
    sourceNode:src,sourcePin:sp,targetNode:tgt,targetPin:tp});
  const ok=r.success!==false&&!r.raw;
  console.log(`${src}.${sp} -> ${tgt}.${tp}: ${ok?'OK':('FAIL '+(r.error||r.raw||'').substring(0,100))}`);
  return ok;
}

(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fixdata',version:'1'}});
  await sleep(1000);

  console.log('=== Fix slot 0 data chain ===');
  // K2Node_VariableGet_100 (Slot Owners array) -> K2Node_GetArrayItem_9 (Array input, get slot 0)
  await connect(bp,'K2Node_VariableGet_100','Slot Owners','K2Node_GetArrayItem_9','Array');
  await sleep(300);
  
  // K2Node_GetArrayItem_9 (Output, slot 0 value) -> K2Node_CallFunction_100 (Object, IsValid check)
  await connect(bp,'K2Node_GetArrayItem_9','Output','K2Node_CallFunction_100','Object');
  await sleep(300);
  
  // Also verify slot 1 chain is complete
  // K2Node_VariableGet_102 -> K2Node_GetArrayItem_100 (already in import, but ensure)
  // K2Node_GetArrayItem_100 -> K2Node_CallFunction_101 (already in import)
  console.log('\n=== Verify slot 1 data chain (already in T3D but double-check) ===');
  await connect(bp,'K2Node_VariableGet_102','Slot Owners','K2Node_GetArrayItem_100','Array');
  await sleep(300);
  await connect(bp,'K2Node_GetArrayItem_100','Output','K2Node_CallFunction_101','Object');
  await sleep(300);
  
  // Also need: slot 0 Array_Set's TargetArray
  // K2Node_VariableGet_101 -> K2Node_CallArrayFunction_100 (TargetArray)
  console.log('\n=== Verify Array_Set TargetArray connections ===');
  await connect(bp,'K2Node_VariableGet_101','Slot Owners','K2Node_CallArrayFunction_100','TargetArray');
  await sleep(300);
  await connect(bp,'K2Node_VariableGet_103','Slot Owners','K2Node_CallArrayFunction_101','TargetArray');
  await sleep(300);
  
  // Item (OtherActor) connections
  console.log('\n=== Verify Array_Set Item (OtherActor) connections ===');
  await connect(bp,'K2Node_ComponentBoundEvent_0','OtherActor','K2Node_CallArrayFunction_100','Item');
  await sleep(300);
  await connect(bp,'K2Node_ComponentBoundEvent_0','OtherActor','K2Node_CallArrayFunction_101','Item');
  await sleep(300);

  console.log('\n=== Compile ===');
  const r=await bp({action:'compile',path:BP,assetPath:BP});
  console.log('Compile:',r.success?'SUCCESS':('FAIL: '+(r.error||'').substring(0,200)));
  if(r.errors) r.errors.forEach(e=>console.log('  ERR:',e));
  if(r.warnings) r.warnings.slice(0,5).forEach(w=>console.log('  WARN:',w));

  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
