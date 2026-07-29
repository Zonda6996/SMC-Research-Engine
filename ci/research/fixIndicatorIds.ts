import {execFileSync}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const rd=(p:string)=>readFileSync(p,'utf8'),wr=(p:string,s:string)=>writeFileSync(p,s),run=(c:string,a:string[])=>execFileSync(c,a,{stdio:'inherit'});
let h=rd('tools/visualizer/public/index.html');for(const[a,b]of[['id="source"><option value="hlc3"','id="apexSource"><option value="hlc3"'],['id="lookback"','id="apexLookback"'],['id="kInner"','id="apexKInner"'],['id="kOuter"','id="apexKOuter"']]){if(!h.includes(a))throw Error('не найден '+a);h=h.replace(a,b)}wr('tools/visualizer/public/index.html',h);
let m=rd('tools/visualizer/public/panels/indicators.mjs');
m=m.replace("const ids=Object.keys(DEF)","const ids=Object.keys(DEF)\nconst DOM={source:'apexSource',lookback:'apexLookback',kInner:'apexKInner',kOuter:'apexKOuter'}\nconst elFor=(id)=>$(DOM[id]||id)")
.replaceAll("const el=$(id)","const el=elFor(id)")
.replace("for(const id of ids){const el=$(id);","for(const id of ids){const el=elFor(id);");
wr('tools/visualizer/public/panels/indicators.mjs',m);
run('bash',['-lc','npx tsx --test tests/*.test.ts']);run('npx',['tsc','--noEmit']);run('bash',['-lc','node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs']);
run('git',['config','user.name','github-actions[bot]']);run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);run('git',['add','tools/visualizer/public/index.html','tools/visualizer/public/panels/indicators.mjs']);run('git',['commit','-m','visualizer: namespace Apex setting ids']);run('git',['push','origin','HEAD:apex-reversal-v1']);
