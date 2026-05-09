const {spawn}=require('child_process');
const fs=require('fs');

async function runMCP(nodeIds, label) {
  return new Promise((resolve)=>{
    const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
    let id=1;const wait=new Map();
    function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},50000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
    let buf='';
    mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch(e){}}});
    mcp.stderr.on('data',()=>{});
    async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,200)};}}
    
    (async()=>{
      await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t3d',version:'1'}});
      const BP='/Game/BluePrint/BP_Enemy1';
      const r=await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:nodeIds});
      mcp.kill();
      resolve(r);
    })().catch(e=>{mcp.kill();resolve({success:false,error:e.message});});
  });
}

(async()=>{
  // Batch 1: BeginOverlap slot assignment flow
  const batch1=[
    'kCeAXku2Xz37OKmQVsleuQ', // On Component Begin Overlap
    'nlwGpEu8MFTGTCSUJxfrPA', // Cast To BP_LightBall
    'v0ss2E_wc74cr5WRrHAxnQ', // Add (Active Ball)
    'GXZz8knFthLsC8eap8j7Qg', // For Loop (slots)
    'gqSD-0_rWGsNAqymKXFuLQ', // Get Slot Owners
    'Xxov3kOXrmSg_mSd04iGDQ', // Get (a copy)
    'zsL1UUVpSNnBql-tYFOG2w', // Is Valid
    '8A3cO0LB8cgTc9-Stvd3gA', // Branch
    'qopM0ULbzVwGBl2vEqMFGA', // Set Array Elem
    'tvQv3UouPIv9ZZqVqONYvA', // Get Slot Owners (for Set)
    'Q_FHU0Vs6VKlO_i-G-mavA', // Reroute
    'js5YkULyKJO5JLunztUrBw', // Set isInChecker
  ];
  
  console.log('Fetching batch 1...');
  const r1=await runMCP(batch1,'batch1');
  if(r1.success){
    const t3d=r1.t3d||'';
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/batch1.t3d',t3d);
    console.log('Batch1 OK, len=',t3d.length);
    parseConnections(t3d,'BATCH1');
  } else {
    console.log('Batch1 FAIL:',r1.error);
  }
  
  // Batch 2: Check Overlapping Light Checker flow  
  const batch2=[
    '2xz7-UcVD_xxfYurxQMfmg', // Check Overlapping Light Checker
    'xFayEkeZsBjb976ENHB4uw', // For Each Loop
    'xqE36knD_g3Ic3iRGOj-Rw', // Branch (slot 0 check)
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
  
  console.log('Fetching batch 2...');
  const r2=await runMCP(batch2,'batch2');
  if(r2.success){
    const t3d=r2.t3d||'';
    fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/batch2.t3d',t3d);
    console.log('Batch2 OK, len=',t3d.length);
    parseConnections(t3d,'BATCH2');
  } else {
    console.log('Batch2 FAIL:',r2.error);
  }
  
  process.exit(0);
})();

function parseConnections(t3d, label){
  console.log('\n=== '+label+' PIN CONNECTIONS ===');
  // Find object names and their linked pins
  const objBlocks=t3d.split(/(?=Begin Object Class=)/);
  for(const block of objBlocks){
    const nameMatch=block.match(/Name="([^"]+)"/);
    if(!nameMatch)continue;
    const objName=nameMatch[1];
    // Find all pins with LinkedTo
    const pinMatches=[...block.matchAll(/PinName="([^"]+)"[^)]*?LinkedTo=\(([^)]+)\)/g)];
    const pinDefaults=[...block.matchAll(/PinName="([^"]+)"[^)]*?DefaultValue="([^"]+)"/g)];
    if(pinMatches.length>0||pinDefaults.length>0){
      console.log('\n  Object:',objName);
      for(const m of pinMatches){
        console.log('    pin['+m[1]+'] -> '+m[2].substring(0,120));
      }
      for(const m of pinDefaults){
        console.log('    pin['+m[1]+'] default="'+m[2]+'"');
      }
    }
  }
}
