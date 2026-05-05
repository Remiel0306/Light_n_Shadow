const { spawn } = require('child_process');
const PROJECT='D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP='/Game/BluePrint/BP_Enemy1';
const GRAPH='EventGraph';
const IDS=['JeBcSk2Mvy0tIC-TEamIfw','Z0m1UUZ_-bNlcz6IJN7RXA'];
const mcp=spawn('npx.cmd',['ue-mcp',PROJECT],{shell:true});
let id=1; const pending=new Map();
function rpc(method, params){return new Promise(r=>{const i=id++; pending.set(i,r); mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
function parse(res){const t=res?.result?.content?.[0]?.text; try{return JSON.parse(t);}catch{return {success:false,error:t};}}
mcp.stdout.on('data',d=>{for(const line of d.toString().split('\n')){if(!line.trim())continue; try{const m=JSON.parse(line); const cb=pending.get(m.id); if(cb){pending.delete(m.id); cb(m);}}catch{}}});
async function bp(a){const r=await rpc('tools/call',{name:'blueprint',arguments:a}); const p=parse(r); if(!p.success) throw new Error(p.error||JSON.stringify(p)); return p;}
(async()=>{
 await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'node-id-inspect',version:'1.0'}});
 const g=await bp({action:'read_graph',path:BP,assetPath:BP,graphName:GRAPH});
 for(const id of IDS){
   const n=(g.nodes||[]).find(x=>x.id===id);
   console.log('NODE',id, n? {title:n.title,class:n.class}: null);
   if(n) console.log('PINS', (n.pins||[]).map(p=>({name:p.name,direction:p.direction,connected:p.connected}))); 
 }
 process.exit(0);
})().catch(e=>{console.error('FAILED:',e.message); process.exit(1);});
