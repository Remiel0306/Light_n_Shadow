const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let id=1;
function send(method, params) { mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:id++,method,params})+'\n'); }
mcp.stdout.on('data', d => {
  const lines = d.toString().split('\n');
  for(let line of lines) {
    if(!line.trim()) continue;
    try {
      const res = JSON.parse(line);
      if(res.id===1) {
          send('tools/call', {
              name:'editor', 
              arguments:{
                  action:'execute_python', 
                  code:"import unreal\nunreal.SystemLibrary.print_string(None, 'MCP SAYS HELLO', True, True, unreal.LinearColor(0,1,0,1), 10.0)\nunreal.log('MCP SAYS HELLO IN LOG')"
              }
          });
      }
      else if(res.id===2) { 
          console.log(res.result.content[0].text); 
          process.exit(0); 
      }
    } catch(e){}
  }
});
send('initialize', {protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'test',version:'1.0'}});
