const {spawn}=require('child_process');

function mkMCP() {
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},50000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,300)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}

const BP = '/Game/BluePrint/BP_Enemy1';

(async()=>{
  const {rpc, bp, kill} = mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fix_final',version:'1'}});

  // ===== STEP 1: Delete broken original nodes (by T3D name) =====
  console.log('\n=== STEP 1: Delete broken original nodes ===');
  // Note: K2Node_MacroInstance_1 (ForLoop) was already deleted in test_params.js
  const originalBroken = [
    'K2Node_GetArrayItem_0',    // GetArrayItem (reads slot index)
    'K2Node_CallFunction_52',   // IsValid (checks if slot occupied)
    'K2Node_IfThenElse_0',      // Branch (is slot occupied?)
    'K2Node_CallArrayFunction_9', // Array_Set (hardcoded index=0)
    'K2Node_VariableGet_37',    // Get Slot Owners (for Array_Set TargetArray)
    'K2Node_Knot_1',            // Reroute (carries OtherActor)
    'K2Node_VariableGet_36',    // Get Slot Owners (for GetArrayItem Array)
  ];
  for(const name of originalBroken){
    const r=await bp({action:'delete_node',path:BP,assetPath:BP,graphName:'EventGraph',nodeName:name});
    console.log('Delete',name,':', r.success?'OK':('SKIP/'+r.error?.substring(0,50)));
  }
  
  // ===== STEP 2: Cleanup orphaned nodes from previous failed script runs =====
  console.log('\n=== STEP 2: Cleanup orphaned nodes ===');
  const r_cleanup = await bp({action:'cleanup_graph',path:BP,assetPath:BP,graphName:'EventGraph'});
  console.log('Cleanup:', r_cleanup.success?('OK - removed '+r_cleanup.removedCount+' nodes'):('FAIL: '+r_cleanup.error));
  
  // ===== STEP 3: Add new sequential slot-check nodes =====
  console.log('\n=== STEP 3: Add new nodes ===');
  
  // Layout plan (continuing from Set isInChecker at ~X=912, Y=624):
  // X=1050: GetSlot0 (read)
  // X=1250: GetItem0
  // X=1430: IsValid0
  // X=1630: Branch0 (if slot 0 occupied → go to slot 1 check; else → ArraySet0)
  // X=1840: ArraySet0 (set slot 0)
  // X=1490: GetSlot0b (for ArraySet0 TargetArray)
  // X=2200: GetSlot1 (read)
  // X=2400: GetItem1
  // X=2580: IsValid1
  // X=2780: Branch1 (if slot 1 occupied → do nothing; else → ArraySet1)
  // X=2990: ArraySet1 (set slot 1)
  // X=2640: GetSlot1b (for ArraySet1 TargetArray)
  
  let ids = {};
  
  async function addNode(label, args) {
    const r = await bp({...args, path:BP, assetPath:BP, graphName:'EventGraph'});
    ids[label] = r.nodeId;
    console.log(label+':', r.nodeId||'?', r.success?'OK':r.error);
    return r.nodeId;
  }
  
  await addNode('getSlot0', {action:'add_node', nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:1050, posY:780});
  await addNode('getItem0', {action:'add_node', nodeClass:'K2Node_GetArrayItem', posX:1250, posY:780});
  await addNode('isValid0', {action:'add_node', nodeClass:'K2Node_CallFunction', functionName:'IsValid', functionClass:'/Script/Engine.KismetSystemLibrary', posX:1450, posY:750});
  await addNode('branch0',  {action:'add_node', nodeClass:'K2Node_IfThenElse', posX:1640, posY:624});
  await addNode('getSlot0b',{action:'add_node', nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:1640, posY:780});
  await addNode('arraySet0',{action:'add_node', nodeClass:'K2Node_CallArrayFunction', functionName:'Array_Set', functionClass:'/Script/Engine.KismetArrayLibrary', posX:1880, posY:624});
  
  await addNode('getSlot1', {action:'add_node', nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:2050, posY:780});
  await addNode('getItem1', {action:'add_node', nodeClass:'K2Node_GetArrayItem', posX:2250, posY:780});
  await addNode('isValid1', {action:'add_node', nodeClass:'K2Node_CallFunction', functionName:'IsValid', functionClass:'/Script/Engine.KismetSystemLibrary', posX:2450, posY:750});
  await addNode('branch1',  {action:'add_node', nodeClass:'K2Node_IfThenElse', posX:2640, posY:624});
  await addNode('getSlot1b',{action:'add_node', nodeClass:'K2Node_VariableGet', variableName:'Slot Owners', posX:2640, posY:780});
  await addNode('arraySet1',{action:'add_node', nodeClass:'K2Node_CallArrayFunction', functionName:'Array_Set', functionClass:'/Script/Engine.KismetArrayLibrary', posX:2880, posY:624});
  
  // ===== STEP 4: Set index defaults =====
  console.log('\n=== STEP 4: Set index defaults ===');
  // GetItem1: Dimension 1 = 1 (slot index 1, default is already 0)
  let r = await bp({action:'set_node_property',path:BP,assetPath:BP,graphName:'EventGraph',
    nodeId:ids.getItem1, pinName:'Dimension 1', defaultValue:'1'});
  console.log('GetItem1.Dim1=1:', r.success?'OK':('FAIL: '+r.error));
  
  r = await bp({action:'set_node_property',path:BP,assetPath:BP,graphName:'EventGraph',
    nodeName:ids.getItem1, pinName:'Dimension 1', defaultValue:'1'});
  console.log('GetItem1.Dim1=1 (nodeName):', r.success?'OK':('FAIL: '+r.error));
  
  // ArraySet1: Index = 1
  r = await bp({action:'set_node_property',path:BP,assetPath:BP,graphName:'EventGraph',
    nodeId:ids.arraySet1, pinName:'Index', defaultValue:'1'});
  console.log('ArraySet1.Index=1:', r.success?'OK':('FAIL: '+r.error));
  
  // ===== STEP 5: Connect pins =====
  console.log('\n=== STEP 5: Connect pins ===');
  // Pre-existing nodes by T3D name:
  // Set isInChecker = K2Node_VariableSet_8
  // BeginOverlap = K2Node_ComponentBoundEvent_0
  
  const conns = [
    // SetIsInChecker.then → Branch0.execute
    ['K2Node_VariableSet_8','then',         ids.branch0, 'execute'],
    // GetSlot0.SlotOwners → GetItem0.Array
    [ids.getSlot0,'Slot Owners',            ids.getItem0,'Array'],
    // GetItem0.Output → IsValid0.Object
    [ids.getItem0,'Output',                 ids.isValid0,'Object'],
    // IsValid0.ReturnValue → Branch0.Condition
    [ids.isValid0,'ReturnValue',            ids.branch0, 'Condition'],
    // Branch0.then (slot 0 OCCUPIED) → Branch1.execute (check slot 1)
    [ids.branch0, 'then',                   ids.branch1, 'execute'],
    // Branch0.else (slot 0 EMPTY) → ArraySet0.execute (assign here)
    [ids.branch0, 'else',                   ids.arraySet0,'execute'],
    // GetSlot0b → ArraySet0.TargetArray
    [ids.getSlot0b,'Slot Owners',           ids.arraySet0,'TargetArray'],
    // BeginOverlap.OtherActor → ArraySet0.Item
    ['K2Node_ComponentBoundEvent_0','OtherActor', ids.arraySet0,'Item'],
    // GetSlot1.SlotOwners → GetItem1.Array
    [ids.getSlot1,'Slot Owners',            ids.getItem1,'Array'],
    // GetItem1.Output → IsValid1.Object
    [ids.getItem1,'Output',                 ids.isValid1,'Object'],
    // IsValid1.ReturnValue → Branch1.Condition
    [ids.isValid1,'ReturnValue',            ids.branch1, 'Condition'],
    // Branch1.else (slot 1 EMPTY) → ArraySet1.execute
    [ids.branch1, 'else',                   ids.arraySet1,'execute'],
    // GetSlot1b → ArraySet1.TargetArray
    [ids.getSlot1b,'Slot Owners',           ids.arraySet1,'TargetArray'],
    // BeginOverlap.OtherActor → ArraySet1.Item
    ['K2Node_ComponentBoundEvent_0','OtherActor', ids.arraySet1,'Item'],
  ];
  
  for(const [src,srcPin,tgt,tgtPin] of conns){
    const r=await bp({action:'connect_pins',path:BP,assetPath:BP,graphName:'EventGraph',
      sourceNode:src, sourcePin:srcPin, targetNode:tgt, targetPin:tgtPin});
    console.log(`  ${srcPin}→${tgtPin}:`, r.success?'OK':('FAIL: '+r.error?.substring(0,80)));
  }
  
  // ===== STEP 6: Compile =====
  console.log('\n=== STEP 6: Compile ===');
  r = await bp({action:'compile',path:BP,assetPath:BP});
  console.log('Compile:', r.success?'SUCCESS':('FAIL: '+r.error));
  if(r.errors) r.errors.forEach(e=>console.log('  Error:',e));
  if(r.warnings) r.warnings.slice(0,5).forEach(w=>console.log('  Warn:',w));
  
  kill();
  console.log('\n====== DONE ======');
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
