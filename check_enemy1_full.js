const { spawn } = require('child_process');
const PROJECT='D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP='/Game/BluePrint/BP_Enemy1';
const mcp=spawn('npx.cmd',['ue-mcp',PROJECT],{shell:true});
let id=1; const pending=new Map();
function rpc(method, params){return new Promise(r=>{const i=id++; pending.set(i,r); mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
function parse(res){const t=res?.result?.content?.[0]?.text; try{return JSON.parse(t);}catch{return {success:false,error:t};}}
mcp.stdout.on('data',d=>{for(const line of d.toString().split('\n')){if(!line.trim())continue; try{const m=JSON.parse(line); const cb=pending.get(m.id); if(cb){pending.delete(m.id); cb(m);}}catch{}}});
async function bp(a){const r=await rpc('tools/call',{name:'blueprint',arguments:a}); const p=parse(r); if(!p.success) throw new Error(p.error||JSON.stringify(p)); return p;}
(async()=>{
 await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'bp-check',version:'1.0'}});
 const ev=await bp({action:'read_graph_summary',path:BP,assetPath:BP,graphName:'EventGraph'});
 const build=await bp({action:'read_graph_summary',path:BP,assetPath:BP,graphName:'BuildRayDirsFromActiveBalls'});
 const reset=await bp({action:'read_graph_summary',path:BP,assetPath:BP,graphName:'ResetOneShadowCollider'}).catch(e=>({success:false,error:String(e.message)}));
 const update=await bp({action:'read_graph_summary',path:BP,assetPath:BP,graphName:'UpdateOneShadowCollider'});
 console.log(JSON.stringify({eventGraph:ev,buildRay:build,resetOne:reset,updateOne:update},null,2));
 process.exit(0);
})().catch(e=>{console.error('FAILED:',e.message); process.exit(1);});
