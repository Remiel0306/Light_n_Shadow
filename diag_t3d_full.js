const {spawn}=require('child_process');
const fs=require('fs');
const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
let id=1;const wait=new Map();
function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},60000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
let buf='';
mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch(e){}}});
mcp.stderr.on('data',d=>process.stderr.write(d));
async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,300)};}}

(async()=>{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t3d',version:'1'}});
  const BP='/Game/BluePrint/BP_Enemy1';
  
  const nodeIds=[
    'kCeAXku2Xz37OKmQVsleuQ', // On Component Begin Overlap
    'nlwGpEu8MFTGTCSUJxfrPA', // Cast To BP_LightBall
    'v0ss2E_wc74cr5WRrHAxnQ', // Add (Active Ball)
    'GXZz8knFthLsC8eap8j7Qg', // For Loop (slots check)
    'gqSD-0_rWGsNAqymKXFuLQ', // Get Slot Owners #1
    'vY9J0EsWsN8aWZCkEaOKMw', // Get Slot Owners #2
    'LJ1ofkRQLxWeKqW3Cw5-2w', // Get Slot Owners #3
    'T-RCpEfCdtygOvehPvkDtg', // Get Slot Owners #4
    'Xxov3kOXrmSg_mSd04iGDQ', // Get (a copy)
    'zsL1UUVpSNnBql-tYFOG2w', // Is Valid
    '8A3cO0LB8cgTc9-Stvd3gA', // Branch
    'qopM0ULbzVwGBl2vEqMFGA', // Set Array Elem
    'tvQv3UouPIv9ZZqVqONYvA', // Get Slot Owners (for Set)
    'Q_FHU0Vs6VKlO_i-G-mavA', // Reroute
    'qjDXm0xhQQKpeqWpsXJaRA', // For Loop 2
    '6rJF00e4B8yS3jGaK2Vafw', // Get Slot Owners
    '6ngu5Eq6vvVEaROzVOFTtw', // Get (a copy)
    'AAG4OkkDrIb1jHyI-V87IA', // Equal Object
    'dJ1fdkXhFcyM1FauPdddkw', // Branch
    'js5YkULyKJO5JLunztUrBw', // Set isInChecker
    // Also check Check Overlapping Light Checker flow
    '2xz7-UcVD_xxfYurxQMfmg', // Check Overlapping Light Checker custom event
    'xFayEkeZsBjb976ENHB4uw', // For Each Loop
    'xqE36knD_g3Ic3iRGOj-Rw', // Branch
    'fplE-U5qzQr6_VGUtSvFFg', // Get Slot Owners
    '_CZy70VnaiUyFMqHKk60Uw', // Get (a copy)
    'umDQyES-TgAX7yuIu92LPw', // Equal Object
    'Bf9FP0wDxRrUhI-C31jg7w', // Shadow Collision 1 call
    'pfDWt0sEJ564Z4SluswC2w', // Get Slot Owners
    'SzAGCUeK5HkjPF-FmaGR0w', // Get (a copy)
    '1-MJmEjZqnRYWX6lJwb8ww', // Equal Object
    'C24G7EO98NXVXhyd0PVy4Q', // Branch
    'gnGcyUVFY7VdBI2vEoWwPQ', // Shadow Collision 2 call
  ];
  
  const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:nodeIds});
  if(r.success){
    const t3d=r.t3d||r.t3dContent||'';
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/begin_overlap_nodes.t3d', t3d);
    console.log('Saved T3D, length:',t3d.length);
    
    // Parse key info from T3D
    // Each Object block: Begin Object Class=... Name="..."
    // Find LinkedTo patterns to understand connections
    const linkedTos=[...t3d.matchAll(/PinName="([^"]+)"[^)]*LinkedTo=\(([^)]+)\)/g)];
    console.log('\n=== PIN CONNECTIONS ===');
    for(const m of linkedTos){
      const pinName=m[1];
      const linked=m[2];
      // Find what object this pin belongs to (look backwards for Begin Object)
      const pos=m.index;
      const before=t3d.substring(Math.max(0,pos-500),pos);
      const objMatch=before.match(/Begin Object[^\n]*Name="([^"]+)"/g);
      const objName=objMatch?objMatch[objMatch.length-1]:'?';
      console.log(objName,'pin:'+pinName,'->',linked.substring(0,100));
    }
  } else {
    console.log('FAIL',r.error);
  }
  
  mcp.kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);mcp.kill();process.exit(1);});
