const {spawn}=require('child_process');
const fs=require('fs');

// Convert base64url (summary format) to hex GUID (tool format)
function toHex(b64url) {
  const b64 = b64url.replace(/-/g,'+').replace(/_/g,'/');
  const padded = b64 + '=='.substring(0,(4 - b64.length % 4) % 4);
  return Buffer.from(padded,'base64').toString('hex').toUpperCase();
}

async function runMCP(fn) {
  return new Promise((resolve)=>{
    const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
    let id=1;const wait=new Map();
    function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},50000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
    let buf='';
    mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch(e){}}});
    mcp.stderr.on('data',()=>{});
    async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,300)};}}
    (async()=>{
      await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fix2',version:'1'}});
      try { await fn(bp); } catch(e) { console.error('Error:',e.message); }
      mcp.kill(); resolve();
    })();
  });
}

const BP = '/Game/BluePrint/BP_EnemyShadowLogic';

// Pre-existing node IDs (base64url → hex GUID)
const SET_ISINCHECKER  = toHex('js5YkULyKJO5JLunztUrBw'); // K2Node_VariableSet_8
const BEGIN_OVERLAP    = toHex('kCeAXku2Xz37OKmQVsleuQ'); // ComponentBoundEvent_0

// Nodes to delete (broken ForLoop cluster)
const TO_DELETE_HEX = [
  toHex('GXZz8knFthLsC8eap8j7Qg'), // ForLoop K2Node_MacroInstance_1
  toHex('Xxov3kOXrmSg_mSd04iGDQ'), // GetArrayItem K2Node_GetArrayItem_0
  toHex('zsL1UUVpSNnBql-tYFOG2w'), // IsValid K2Node_CallFunction_52
  toHex('8A3cO0LB8cgTc9-Stvd3gA'), // Branch K2Node_IfThenElse_0
  toHex('qopM0ULbzVwGBl2vEqMFGA'), // Array_Set K2Node_CallArrayFunction_9
  toHex('tvQv3UouPIv9ZZqVqONYvA'), // GetSlotOwners for Array_Set
  toHex('Q_FHU0Vs6VKlO_i-G-mavA'), // Reroute OtherActor
];

console.log('SET_ISINCHECKER:', SET_ISINCHECKER);
console.log('BEGIN_OVERLAP:', BEGIN_OVERLAP);
console.log('Nodes to delete:', TO_DELETE_HEX);

(async()=>{
  console.log('\n========== STEP 1: Delete broken nodes ==========');
  await runMCP(async (bp)=>{
    for(const nid of TO_DELETE_HEX){
      const r=await bp({action:'delete_node',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:nid});
      console.log('Delete',nid.substring(0,8),':', r.success?'OK':('FAIL: '+r.error));
    }
  });
  
  console.log('\n========== STEP 2: Add new sequential slot-check nodes ==========');
  let ids = {};
  
  await runMCP(async (bp)=>{
    let r;
    
    // Branch0 at X=1300, Y=608
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_IfThenElse',posX:1300,posY:608});
    ids.branch0 = r.nodeId; console.log('Branch0:', ids.branch0, r.success?'OK':r.error);
    
    // GetSlotOwners0 for reading slot 0
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet',variableName:'Slot Owners',posX:1000,posY:760});
    ids.getSlot0 = r.nodeId; console.log('GetSlot0:', ids.getSlot0, r.success?'OK':r.error);
    
    // GetArrayItem0 index=0
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_GetArrayItem',posX:1200,posY:760});
    ids.getItem0 = r.nodeId; console.log('GetItem0:', ids.getItem0, r.success?'OK':r.error);
    
    // IsValid0
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallFunction',functionName:'IsValid',
      functionClass:'/Script/Engine.KismetSystemLibrary',posX:1430,posY:730});
    ids.isValid0 = r.nodeId; console.log('IsValid0:', ids.isValid0, r.success?'OK':r.error);
    
    // ArraySet0 - set slot 0 = OtherActor
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallArrayFunction',functionName:'Array_Set',
      functionClass:'/Script/Engine.KismetArrayLibrary',posX:1640,posY:608});
    ids.arraySet0 = r.nodeId; console.log('ArraySet0:', ids.arraySet0, r.success?'OK':r.error);
    
    // GetSlotOwners0b for ArraySet0 TargetArray
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet',variableName:'Slot Owners',posX:1490,posY:720});
    ids.getSlot0b = r.nodeId; console.log('GetSlot0b:', ids.getSlot0b, r.success?'OK':r.error);
    
    // Branch1 at X=2100, Y=608
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_IfThenElse',posX:2100,posY:608});
    ids.branch1 = r.nodeId; console.log('Branch1:', ids.branch1, r.success?'OK':r.error);
    
    // GetSlotOwners1 for reading slot 1
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet',variableName:'Slot Owners',posX:1800,posY:760});
    ids.getSlot1 = r.nodeId; console.log('GetSlot1:', ids.getSlot1, r.success?'OK':r.error);
    
    // GetArrayItem1 index=1
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_GetArrayItem',posX:2000,posY:760});
    ids.getItem1 = r.nodeId; console.log('GetItem1:', ids.getItem1, r.success?'OK':r.error);
    
    // IsValid1
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallFunction',functionName:'IsValid',
      functionClass:'/Script/Engine.KismetSystemLibrary',posX:2230,posY:730});
    ids.isValid1 = r.nodeId; console.log('IsValid1:', ids.isValid1, r.success?'OK':r.error);
    
    // ArraySet1 - set slot 1 = OtherActor
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallArrayFunction',functionName:'Array_Set',
      functionClass:'/Script/Engine.KismetArrayLibrary',posX:2440,posY:608});
    ids.arraySet1 = r.nodeId; console.log('ArraySet1:', ids.arraySet1, r.success?'OK':r.error);
    
    // GetSlotOwners1b for ArraySet1 TargetArray
    r=await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet',variableName:'Slot Owners',posX:2290,posY:720});
    ids.getSlot1b = r.nodeId; console.log('GetSlot1b:', ids.getSlot1b, r.success?'OK':r.error);
  });
  
  fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/fix_node_ids2.json', JSON.stringify(ids,null,2));
  
  console.log('\n========== STEP 3: Set index defaults ==========');
  await runMCP(async (bp)=>{
    const ids = JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/fix_node_ids2.json','utf8'));
    
    // GetItem1 Dimension 1 = 1 (slot index 1)
    let r=await bp({action:'set_node_property',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeId:ids.getItem1, pinName:'Dimension 1', defaultValue:'1'});
    console.log('GetItem1.Dim1=1:', r.success?'OK':('FAIL: '+r.error));
    
    // ArraySet1 Index = 1
    r=await bp({action:'set_node_property',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeId:ids.arraySet1, pinName:'Index', defaultValue:'1'});
    console.log('ArraySet1.Index=1:', r.success?'OK':('FAIL: '+r.error));
  });
  
  console.log('\n========== STEP 4: Connect pins ==========');
  await runMCP(async (bp)=>{
    const ids = JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/fix_node_ids2.json','utf8'));
    
    const conns = [
      // SetIsInChecker.then → Branch0.execute
      [SET_ISINCHECKER,'then', ids.branch0,'execute'],
      // GetSlot0.SlotOwners → GetItem0.Array
      [ids.getSlot0,'Slot Owners', ids.getItem0,'Array'],
      // GetItem0.Output → IsValid0.Object
      [ids.getItem0,'Output', ids.isValid0,'Object'],
      // IsValid0.ReturnValue → Branch0.Condition
      [ids.isValid0,'ReturnValue', ids.branch0,'Condition'],
      // Branch0.then (occupied) → Branch1.execute
      [ids.branch0,'then', ids.branch1,'execute'],
      // Branch0.else (empty) → ArraySet0.execute
      [ids.branch0,'else', ids.arraySet0,'execute'],
      // GetSlot0b.SlotOwners → ArraySet0.TargetArray
      [ids.getSlot0b,'Slot Owners', ids.arraySet0,'TargetArray'],
      // BeginOverlap.OtherActor → ArraySet0.Item
      [BEGIN_OVERLAP,'OtherActor', ids.arraySet0,'Item'],
      // GetSlot1.SlotOwners → GetItem1.Array
      [ids.getSlot1,'Slot Owners', ids.getItem1,'Array'],
      // GetItem1.Output → IsValid1.Object
      [ids.getItem1,'Output', ids.isValid1,'Object'],
      // IsValid1.ReturnValue → Branch1.Condition
      [ids.isValid1,'ReturnValue', ids.branch1,'Condition'],
      // Branch1.else (empty) → ArraySet1.execute
      [ids.branch1,'else', ids.arraySet1,'execute'],
      // GetSlot1b.SlotOwners → ArraySet1.TargetArray
      [ids.getSlot1b,'Slot Owners', ids.arraySet1,'TargetArray'],
      // BeginOverlap.OtherActor → ArraySet1.Item
      [BEGIN_OVERLAP,'OtherActor', ids.arraySet1,'Item'],
    ];
    
    for(const [src,srcPin,tgt,tgtPin] of conns){
      const r=await bp({action:'connect_pins',path:BP,assetPath:BP,graphName:'EventGraph',
        sourceNodeId:src, sourcePinName:srcPin, targetNodeId:tgt, targetPinName:tgtPin});
      console.log(`  ${srcPin}→${tgtPin}:`, r.success?'OK':('FAIL: '+r.error));
    }
  });
  
  console.log('\n========== STEP 5: Compile ==========');
  await runMCP(async (bp)=>{
    const r=await bp({action:'compile',path:BP,assetPath:BP});
    console.log('Compile:', r.success?'SUCCESS':('FAIL: '+r.error));
    if(r.errors) r.errors.forEach(e=>console.log('  Error:',e));
    if(r.warnings) r.warnings.slice(0,5).forEach(w=>console.log('  Warn:',w));
  });
  
  console.log('\n====== Done! ======');
  process.exit(0);
})();
