const {spawn}=require('child_process');
const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
let id=1;const wait=new Map();
function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},45000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
let buf='';
mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch(e){}}});
mcp.stderr.on('data',d=>process.stderr.write(d));

(async()=>{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'list',version:'1'}});
  // List all tools
  const r=await rpc('tools/list',{});
  const tools=r?.result?.tools||[];
  for(const t of tools){
    console.log('TOOL:',t.name);
    // Show blueprint tool's inputSchema actions
    if(t.name==='blueprint'&&t.inputSchema){
      const props=t.inputSchema?.properties||{};
      if(props.action?.enum){
        console.log('  actions:',props.action.enum.join(', '));
      } else if(props.action?.description){
        console.log('  action desc:',props.action.description);
      }
    }
  }
  mcp.kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);mcp.kill();process.exit(1);});
