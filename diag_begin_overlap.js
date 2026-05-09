const {spawn}=require('child_process');
const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
let id=1;const wait=new Map();
function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},45000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
let buf='';
mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch(e){}}});
mcp.stderr.on('data',d=>process.stderr.write(d));
async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {success:false,error:t};}}

(async()=>{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'diag',version:'1'}});
  const BP='/Game/BluePrint/BP_Enemy1';
  
  // Use read_graph_summary which is lighter
  const data=await bp({action:'read_graph_summary',path:BP,assetPath:BP,graphName:'EventGraph'});
  if(!data.success){console.log('FAIL',data.error);mcp.kill();process.exit(0);}
  
  const nodes=data.nodes||[];
  // BeginOverlap id = kCeAXku2Xz37OKmQVsleuQ
  const beginEvt=nodes.find(n=>n.id==='kCeAXku2Xz37OKmQVsleuQ');
  if(!beginEvt){console.log('BeginOverlap not found in summary');
    // list all titles
    nodes.forEach(n=>console.log(n.title,n.id));
    mcp.kill();process.exit(0);
  }
  console.log('BeginOverlap pos:',beginEvt.posX,beginEvt.posY);
  
  // Find nodes clustered near it
  const bx=beginEvt.posX||0, by=beginEvt.posY||0;
  const nearby=nodes.filter(n=>Math.abs((n.posX||0)-bx)<4000 && Math.abs((n.posY||0)-by)<3000);
  console.log('\nNEARBY COUNT:',nearby.length);
  
  // Get detailed info for each nearby node
  for(const n of nearby){
    const detail=await bp({action:'read_node',path:BP,assetPath:BP,graphName:'EventGraph',nodeId:n.id});
    if(!detail.success){
      console.log('\n[FAIL]',n.title,n.id);
      continue;
    }
    const node=detail.node||detail;
    console.log('\n=== '+n.title+' ('+n.id.substring(0,8)+') pos:('+n.posX+','+n.posY+')');
    const pins=node.pins||node.inputPins||[];
    const allPins=[...(node.inputPins||[]),(node.outputPins||[])];
    for(const p of allPins){
      if(p.connected||p.defaultValue||p.type==='exec'){
        console.log('  ['+p.direction+'] '+p.name+' type='+p.type+' conn='+p.connected+(p.defaultValue?' def='+p.defaultValue:''));
      }
    }
  }
  
  mcp.kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);mcp.kill();process.exit(1);});
