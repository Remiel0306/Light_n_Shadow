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

async function connect(bp,src,sp,tgt,tp){
  const r=await bp({action:'connect_pins',path:BP,assetPath:BP,graphName:'EventGraph',
    sourceNode:src,sourcePin:sp,targetNode:tgt,targetPin:tp});
  const ok=r.success!==false&&!r.raw;
  console.log(`${src}.${sp} -> ${tgt}.${tp}: ${ok?'OK':('FAIL '+(r.error||r.raw||'').substring(0,80))}`);
  return ok;
}

(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fixpins',version:'1'}});
  await sleep(1000);

  console.log('=== Fix 1: IsValid_100.ReturnValue -> IfThenElse_10.Condition ===');
  await connect(bp,'K2Node_CallFunction_100','ReturnValue','K2Node_IfThenElse_10','Condition');
  await sleep(300);
  
  console.log('\n=== Fix 2: IfThenElse_10.else -> Array_Set_100.execute ===');
  await connect(bp,'K2Node_IfThenElse_10','else','K2Node_CallArrayFunction_100','execute');
  await sleep(300);
  
  console.log('\n=== Fix 3: IsValid_101.ReturnValue -> IfThenElse_11.Condition ===');
  await connect(bp,'K2Node_CallFunction_101','ReturnValue','K2Node_IfThenElse_11','Condition');
  await sleep(300);
  
  console.log('\n=== Fix 4: IfThenElse_11.else -> Array_Set_101.execute ===');
  await connect(bp,'K2Node_IfThenElse_11','else','K2Node_CallArrayFunction_101','execute');
  await sleep(300);

  console.log('\n=== Compile ===');
  const r=await bp({action:'compile',path:BP,assetPath:BP});
  console.log('Compile:',r.success?'SUCCESS':('FAIL: '+(r.error||'').substring(0,200)));
  if(r.errors) r.errors.forEach(e=>console.log('  ERR:',e));
  if(r.warnings) r.warnings.slice(0,5).forEach(w=>console.log('  WARN:',w));

  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
