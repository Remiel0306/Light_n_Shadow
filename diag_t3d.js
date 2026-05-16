const {spawn}=require('child_process');
const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
let id=1;const wait=new Map();
function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},45000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
let buf='';
mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch(e){}}});
mcp.stderr.on('data',d=>process.stderr.write(d));
async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,300)};}}

(async()=>{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'diag2',version:'1'}});
  const BP='/Game/BluePrint/BP_EnemyShadowLogic';
  
  // Export BeginOverlap area nodes as T3D to see pin connections
  // Key nodes in the BeginOverlap area:
  const nodeIds=[
    'kCeAXku2Xz37OKmQVsleuQ', // On Component Begin Overlap
    'GXZz8knFthLsC8eap8j7Qg', // For Loop
    'gqSD-0_rWGsNAqymKXFuLQ', // Get Slot Owners
    'Xxov3kOXrmSg_mSd04iGDQ', // Get (a copy)
    'zsL1UUVpSNnBql-tYFOG2w', // Is Valid
    '8A3cO0LB8cgTc9-Stvd3gA', // Branch
    'qopM0ULbzVwGBl2vEqMFGA', // Set Array Elem
    'tvQv3UouPIv9ZZqVqONYvA', // Get Slot Owners (for Set)
    'Q_FHU0Vs6VKlO_i-G-mavA', // Reroute
    // Second For Loop cluster
    'qjDXm0xhQQKpeqWpsXJaRA', // For Loop 2
    '6rJF00e4B8yS3jGaK2Vafw', // Get Slot Owners
    '6ngu5Eq6vvVEaROzVOFTtw', // Get (a copy)
    'AAG4OkkDrIb1jHyI-V87IA', // Equal Object
    'dJ1fdkXhFcyM1FauPdddkw', // Branch
    // Cast node if any
    'nlwGpEu8MFTGTCSUJxfrPA', // Cast To BP_LightBall
    // Active Ball add
    'v0ss2E_wc74cr5WRrHAxnQ', // Add (Active Ball)
  ];
  
  const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:nodeIds});
  if(r.success){
    console.log(r.t3dContent||r.content||JSON.stringify(r).substring(0,3000));
  } else {
    console.log('FAIL export_t3d:',r.error);
    // Fallback: try read_node_property for key nodes
    for(const nid of ['GXZz8knFthLsC8eap8j7Qg','qopM0ULbzVwGBl2vEqMFGA','8A3cO0LB8cgTc9-Stvd3gA','zsL1UUVpSNnBql-tYFOG2w']){
      const rp=await bp({action:'read_node_property',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:nid,property:'all'});
      console.log('\n--- node',nid.substring(0,8),'---');
      console.log(rp.success?JSON.stringify(rp).substring(0,500):rp.error);
    }
  }
  
  mcp.kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);mcp.kill();process.exit(1);});
