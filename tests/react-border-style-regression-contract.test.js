const fs=require('fs');const path=require('path');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):/\.(jsx|js)$/.test(e.name)?[path.join(d,e.name)]:[])}
const files=walk(path.join(__dirname,'..','src')); const bad=[];
for(const f of files){let s=fs.readFileSync(f,'utf8'); s=s.replace(/`(?:\\.|[^`])*`/gs,'``'); const re=/\bborder\s*:\s*(?:["']|0\b)/g; let m; while((m=re.exec(s))) bad.push(`${path.relative(path.join(__dirname,'..'),f)}:${s.slice(0,m.index).split('\n').length}`)}
if(bad.length) throw new Error('React inline style border shorthand remains; use borderWidth/borderStyle/borderColor instead:\n'+bad.join('\n'));
console.log('react border style regression contract: PASS');
