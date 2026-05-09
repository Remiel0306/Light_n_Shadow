const {spawn}=require('child_process');
function mkMCP(){
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},90000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  return {rpc, kill:()=>mcp.kill()};
}
(async()=>{
  const {rpc,kill}=mkMCP();
  const r1=await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'list',version:'1'}});
  const r2=await rpc('tools/list',{});
  console.log(JSON.stringify(r2?.result,null,2).substring(0,3000));
  kill();process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
