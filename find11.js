const fs=require('fs');
const t=fs.readFileSync('D:/Unreal Engine/Light_n_Shadow/all_branches.t3d','utf8');
const needle='Name="K2Node_IfThenElse_11"';
const idx=t.indexOf(needle);
if(idx<0){console.log('not found');process.exit(0);}
const start=t.lastIndexOf('Begin Object',idx);
const end=t.indexOf('End Object',start)+10;
console.log(t.substring(start,end));
