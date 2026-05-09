const {spawn}=require('child_process');
const fs=require('fs');

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
      await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fix',version:'1'}});
      try {
        await fn(bp);
      } catch(e) {
        console.error('Script error:', e.message);
      }
      mcp.kill();
      resolve();
    })();
  });
}

const BP = '/Game/BluePrint/BP_Enemy1';

// ====== STEP 1: Delete broken ForLoop cluster ======
// Node IDs from T3D analysis:
// GXZz8knFthLsC8eap8j7Qg = ForLoop (K2Node_MacroInstance_1)
// Xxov3kOXrmSg_mSd04iGDQ = GetArrayItem (K2Node_GetArrayItem_0)
// zsL1UUVpSNnBql-tYFOG2w = IsValid (K2Node_CallFunction_52)
// 8A3cO0LB8cgTc9-Stvd3gA = Branch (K2Node_IfThenElse_0)
// qopM0ULbzVwGBl2vEqMFGA = Array_Set broken (K2Node_CallArrayFunction_9)
// tvQv3UouPIv9ZZqVqONYvA = Get Slot Owners (for Array_Set TargetArray) (K2Node_VariableGet_37)
// Q_FHU0Vs6VKlO_i-G-mavA = Reroute OtherActor (K2Node_Knot_1)
const TO_DELETE = [
  'GXZz8knFthLsC8eap8j7Qg',
  'Xxov3kOXrmSg_mSd04iGDQ',
  'zsL1UUVpSNnBql-tYFOG2w',
  '8A3cO0LB8cgTc9-Stvd3gA',
  'qopM0ULbzVwGBl2vEqMFGA',
  'tvQv3UouPIv9ZZqVqONYvA',
  'Q_FHU0Vs6VKlO_i-G-mavA',
];

(async()=>{
  console.log('\n========== STEP 1: Delete broken nodes ==========');
  await runMCP(async (bp)=>{
    for(const nid of TO_DELETE){
      const r=await bp({action:'delete_node',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:nid});
      console.log('Delete',nid.substring(0,8),':', r.success?'OK':('FAIL: '+r.error));
    }
  });
  
  console.log('\n========== STEP 2: Add new sequential slot-check nodes ==========');
  let branch0Id, branch1Id, getItem0Id, getItem1Id, isValid0Id, isValid1Id;
  let arraySet0Id, arraySet1Id, getSlot0Id, getSlot0bId, getSlot1Id, getSlot1bId;
  
  await runMCP(async (bp)=>{
    // Positions: continuing from Set isInChecker at X=912, Y=624
    // Branch0 (check if slot 0 is occupied)
    let r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_IfThenElse', posX:1300, posY:608});
    branch0Id = r.nodeId;
    console.log('Branch0:', branch0Id, r.success?'OK':r.error);
    
    // GetSlotOwners for slot 0 (to pass to GetArrayItem)
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:1000, posY:760});
    getSlot0Id = r.nodeId;
    console.log('GetSlot0:', getSlot0Id, r.success?'OK':r.error);
    
    // GetArrayItem[0] - Get slot 0 value
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_GetArrayItem', posX:1200, posY:760});
    getItem0Id = r.nodeId;
    console.log('GetItem0:', getItem0Id, r.success?'OK':r.error);
    
    // IsValid0
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallFunction', functionName:'IsValid',
      functionClass:'/Script/Engine.KismetSystemLibrary', posX:1430, posY:730});
    isValid0Id = r.nodeId;
    console.log('IsValid0:', isValid0Id, r.success?'OK':r.error);
    
    // Branch1 (check if slot 1 is occupied) - triggered from Branch0.then (slot 0 occupied)
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_IfThenElse', posX:2100, posY:608});
    branch1Id = r.nodeId;
    console.log('Branch1:', branch1Id, r.success?'OK':r.error);
    
    // GetSlotOwners for slot 1
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:1800, posY:760});
    getSlot1Id = r.nodeId;
    console.log('GetSlot1:', getSlot1Id, r.success?'OK':r.error);
    
    // GetArrayItem[1] - Get slot 1 value
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_GetArrayItem', posX:2000, posY:760});
    getItem1Id = r.nodeId;
    console.log('GetItem1:', getItem1Id, r.success?'OK':r.error);
    
    // IsValid1
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallFunction', functionName:'IsValid',
      functionClass:'/Script/Engine.KismetSystemLibrary', posX:2230, posY:730});
    isValid1Id = r.nodeId;
    console.log('IsValid1:', isValid1Id, r.success?'OK':r.error);
    
    // ArraySet0 - assign OtherActor to slot 0
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallArrayFunction', functionName:'Array_Set',
      functionClass:'/Script/Engine.KismetArrayLibrary', posX:1640, posY:608});
    arraySet0Id = r.nodeId;
    console.log('ArraySet0:', arraySet0Id, r.success?'OK':r.error);
    
    // GetSlotOwners for ArraySet0 TargetArray
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:1490, posY:720});
    getSlot0bId = r.nodeId;
    console.log('GetSlot0b:', getSlot0bId, r.success?'OK':r.error);
    
    // ArraySet1 - assign OtherActor to slot 1
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_CallArrayFunction', functionName:'Array_Set',
      functionClass:'/Script/Engine.KismetArrayLibrary', posX:2440, posY:608});
    arraySet1Id = r.nodeId;
    console.log('ArraySet1:', arraySet1Id, r.success?'OK':r.error);
    
    // GetSlotOwners for ArraySet1 TargetArray
    r = await bp({action:'add_node',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:2290, posY:720});
    getSlot1bId = r.nodeId;
    console.log('GetSlot1b:', getSlot1bId, r.success?'OK':r.error);
  });
  
  // Save IDs to file for next step
  const ids = {branch0Id,branch1Id,getItem0Id,getItem1Id,isValid0Id,isValid1Id,
               arraySet0Id,arraySet1Id,getSlot0Id,getSlot0bId,getSlot1Id,getSlot1bId};
  fs.writeFileSync('D:/Unreal Engine/Light_n_Shadow/fix_node_ids.json', JSON.stringify(ids,null,2));
  console.log('\nSaved node IDs to fix_node_ids.json');
  
  console.log('\n========== STEP 3: Set pin defaults and connect ==========');
  await runMCP(async (bp)=>{
    const ids = JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/fix_node_ids.json','utf8'));
    const {branch0Id,branch1Id,getItem0Id,getItem1Id,isValid0Id,isValid1Id,
           arraySet0Id,arraySet1Id,getSlot0Id,getSlot0bId,getSlot1Id,getSlot1bId} = ids;
    
    // Set GetItem1's Dimension 1 to 1 (slot 1 index)
    let r = await bp({action:'set_node_property',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeId:getItem1Id, pinName:'Dimension 1', defaultValue:'1'});
    console.log('Set GetItem1.index=1:', r.success?'OK':r.error);
    
    // Set ArraySet1's Index to 1
    r = await bp({action:'set_node_property',path:BP,assetPath:BP,graphName:'EventGraph',
      nodeId:arraySet1Id, pinName:'Index', defaultValue:'1'});
    console.log('Set ArraySet1.Index=1:', r.success?'OK':r.error);
    
    // Connections:
    const SET_ISINCHECKER = 'js5YkULyKJO5JLunztUrBw';
    const BEGIN_OVERLAP = 'kCeAXku2Xz37OKmQVsleuQ';
    
    const conns = [
      // SetIsInChecker.then → Branch0.execute
      [SET_ISINCHECKER, 'then', branch0Id, 'execute'],
      // GetSlot0 → GetItem0.Array
      [getSlot0Id, 'Slot Owners', getItem0Id, 'Array'],
      // GetItem0.Output → IsValid0.Object
      [getItem0Id, 'Output', isValid0Id, 'Object'],
      // IsValid0.ReturnValue → Branch0.Condition
      [isValid0Id, 'ReturnValue', branch0Id, 'Condition'],
      // Branch0.then (occupied) → Branch1.execute
      [branch0Id, 'then', branch1Id, 'execute'],
      // Branch0.else (empty) → ArraySet0.execute
      [branch0Id, 'else', arraySet0Id, 'execute'],
      // GetSlot0b → ArraySet0.TargetArray
      [getSlot0bId, 'Slot Owners', arraySet0Id, 'TargetArray'],
      // BeginOverlap.OtherActor → ArraySet0.Item
      [BEGIN_OVERLAP, 'OtherActor', arraySet0Id, 'Item'],
      // GetSlot1 → GetItem1.Array
      [getSlot1Id, 'Slot Owners', getItem1Id, 'Array'],
      // GetItem1.Output → IsValid1.Object
      [getItem1Id, 'Output', isValid1Id, 'Object'],
      // IsValid1.ReturnValue → Branch1.Condition
      [isValid1Id, 'ReturnValue', branch1Id, 'Condition'],
      // Branch1.else (empty) → ArraySet1.execute
      [branch1Id, 'else', arraySet1Id, 'execute'],
      // GetSlot1b → ArraySet1.TargetArray
      [getSlot1bId, 'Slot Owners', arraySet1Id, 'TargetArray'],
      // BeginOverlap.OtherActor → ArraySet1.Item
      [BEGIN_OVERLAP, 'OtherActor', arraySet1Id, 'Item'],
    ];
    
    for(const [src, srcPin, tgt, tgtPin] of conns){
      const r = await bp({action:'connect_pins',path:BP,assetPath:BP,graphName:'EventGraph',
        sourceNodeId:src, sourcePinName:srcPin, targetNodeId:tgt, targetPinName:tgtPin});
      console.log(`  ${srcPin} → ${tgtPin}:`, r.success?'OK':('FAIL: '+r.error));
    }
  });
  
  console.log('\n========== STEP 4: Compile ==========');
  await runMCP(async (bp)=>{
    const r = await bp({action:'compile',path:BP,assetPath:BP});
    console.log('Compile:', r.success?'SUCCESS':('FAIL: '+r.error));
    if(r.errors) r.errors.forEach(e=>console.log('  Error:',e));
    if(r.warnings) r.warnings.slice(0,5).forEach(w=>console.log('  Warn:',w));
  });
  
  console.log('\nDone!');
  process.exit(0);
})();
