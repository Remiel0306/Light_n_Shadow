const {spawn}=require('child_process');
function mkMCP(){
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},90000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function call(name,args){const r=await rpc('tools/call',{name,arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {raw:(t||'').substring(0,400)};}}
  return {rpc, call, kill:()=>mcp.kill()};
}
const BP='/Game/BluePrint/BP_EnemyShadowLogic';
(async()=>{
  const {rpc,call,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'save3',version:'1'}});
  const r=await call('asset',{action:'save',assetPath:BP});
  console.log('save:',r.success?'OK':(r.raw||r.error||JSON.stringify(r)).substring(0,300));
  kill();process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
