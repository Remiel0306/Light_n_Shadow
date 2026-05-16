const {spawn}=require('child_process');
const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
let id=1;const wait=new Map();
function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},45000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
let buf='';
mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch(e){}}});
mcp.stderr.on('data',d=>process.stderr.write(d));
async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,200)};}}

(async()=>{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'diag',version:'1'}});
  const BP='/Game/BluePrint/BP_EnemyShadowLogic';
  
  // Try get_execution_flow with nodeId
  const r=await bp({action:'get_execution_flow',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:'kCeAXku2Xz37OKmQVsleuQ'});
  console.log('=== BeginOverlap flow (by nodeId) ===');
  if(r.success){
    for(const step of r.steps||[]){
      console.log(step.class,'|',step.title,'|',step.id.substring(0,8));
      for(const b of step.branches||[]){
        console.log('  ->',b.pin,'->',b.toId.substring(0,8));
      }
    }
  } else {
    console.log('FAIL',r.error);
  }
  
  // Also try Check Overlapping Light Checker flow
  const r2=await bp({action:'get_execution_flow',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:'2xz7-UcVD_xxfYurxQMfmg'});
  console.log('\n=== Check Overlapping Light Checker flow ===');
  if(r2.success){
    for(const step of r2.steps||[]){
      console.log(step.class,'|',step.title,'|',step.id.substring(0,8));
      for(const b of step.branches||[]){
        console.log('  ->',b.pin,'->',b.toId.substring(0,8));
      }
    }
  } else {
    console.log('FAIL',r2.error);
  }
  
  mcp.kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);mcp.kill();process.exit(1);});
