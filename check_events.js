const {spawn}=require('child_process');
function mkMCP(){
  const mcp=spawn('npx.cmd',['ue-mcp','D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'],{shell:true});
  let id=1;const wait=new Map();
  function rpc(method,params){return new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>{wait.delete(i);rej(new Error('timeout '+method));},90000);wait.set(i,m=>{clearTimeout(t);res(m);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});}
  let buf='';
  mcp.stdout.on('data',d=>{buf+=d.toString();const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;try{const m=JSON.parse(line);const cb=wait.get(m.id);if(cb){wait.delete(m.id);cb(m);}}catch{}}}); 
  mcp.stderr.on('data',()=>{});
  async function bp(args){const r=await rpc('tools/call',{name:'blueprint',arguments:args});const t=r?.result?.content?.[0]?.text;try{return JSON.parse(t);}catch{return {raw:(t||'').substring(0,800)};}}
  return {rpc, bp, kill:()=>mcp.kill()};
}
const BP='/Game/BluePrint/BP_EnemyShadowLogic';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  const {rpc,bp,kill}=mkMCP();
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'chkevts',version:'1'}});
  await sleep(1000);
  const fs=require('fs');
  const summary=JSON.parse(fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/graph_summary.json','utf8'));
  const nodes=Array.isArray(summary)?summary:(summary.nodes||summary.summary||[]);
  
  // Find custom events
  const events=nodes.filter(n=>n.class==='K2Node_CustomEvent');
  console.log('Custom Events:',events.map(n=>n.title));
  
  // Also show all CallCustomEvent nodes (those that call the events)
  const callEvts=nodes.filter(n=>n.class==='K2Node_CallFunction'&&n.title&&(n.title.includes('Shadow Collision')||n.title.includes('Check Overlapping')));
  console.log('CallFunction relevant:',callEvts.map(n=>n.title));
  
  kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
