const {spawn}=require('child_process');

function mkMCP() {
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},60000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:(t||'').substring(0,300)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}

// Convert hex GUID to base64url (for export_nodes_t3d)
function hexToB64url(hex) {
  return Buffer.from(hex, 'hex').toString('base64url');
}

const BP = '/Game/BluePrint/BP_Enemy1';

// Node IDs from fix_final.js run
const nodeHexIds = {
  getSlot0:  '206A3E344CF7114C033975AE04802007',
  getItem0:  '6FC93C7B4309D2158BAAF19C8632C48C',
  isValid0:  'B8A9499C49B0AE86ED9FCEA9D7A83D06',
  branch0:   '774EE7524452F2FF9BB15A99179B7812',
  getSlot0b: '0024C2F54D0AFAF300D5D188A7D6F940',
  arraySet0: 'DB280BC0413ACD516888E29D9B225B14',
  getSlot1:  '16C517AF4469A8726137A58E0682A03C',
  getItem1:  '411A064B4681994D935AB9894691BC83',
  isValid1:  'D84D72684ABC2D3F79F0A0BF99A74180',
  branch1:   '67FD8A9148F4155E965F7B83B2E9E7D1',
  getSlot1b: '3A6F38FB4F8D60304618ED8C6866DB57',
  arraySet1: '5E09FB904FD2115C6762649B54F615BF',
};

(async()=>{
  const {rpc, bp, kill} = mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'pincheck',version:'1'}});

  // Export a sample of the new nodes to check pin names
  const sampleIds = [
    nodeHexIds.getSlot0,   // VariableGet Slot Owners
    nodeHexIds.getItem0,   // GetArrayItem
    nodeHexIds.isValid0,   // IsValid
    nodeHexIds.branch0,    // IfThenElse (Branch)
    nodeHexIds.arraySet0,  // Array_Set
  ].map(hexToB64url);
  
  console.log('Exporting sample nodes...');
  const r = await bp({action:'export_nodes_t3d',path:BP,assetPath:BP,graphName:'EventGraph',nodeIds:sampleIds});
  
  if(r.success){
    const t3d = r.t3d||'';
    // Parse out all pin names
    const objBlocks = t3d.split(/\nEnd Object\n/);
    for(const block of objBlocks){
      const nameMatch = block.match(/Name="([^"]+)"/);
      if(!nameMatch) continue;
      const objName = nameMatch[1];
      const pins = [...block.matchAll(/PinName="([^"]+)",.*?Direction="(EGPD_(?:Input|Output))"/g)];
      const allPins = [...block.matchAll(/PinName="([^"]+)"/g)];
      console.log('\n--- '+objName+' ---');
      for(const m of allPins){
        const pinName = m[1];
        // Check direction
        const dirMatch = block.substring(m.index, m.index+200).match(/Direction="(EGPD_(?:Input|Output))"/);
        const dir = dirMatch ? (dirMatch[1]==='EGPD_Output'?'OUT':'IN') : 'IO?';
        // Check linked
        const linkedMatch = block.substring(m.index, m.index+500).match(/LinkedTo=\(([^)]+)\)/);
        const linked = linkedMatch?'LINKED':'';
        console.log('  ['+dir+'] "'+pinName+'" '+linked);
      }
    }
  } else {
    console.log('Export failed:', r.error);
  }
  
  kill();
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
