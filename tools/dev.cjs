// Keep Vite alive across a deliberate Electron workspace restart (exit 75).
const {spawn}=require('child_process');
const path=require('path');
const root=path.resolve(__dirname,'..');
let desktop,server,stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;if(desktop)desktop.kill();if(server)await server.close();process.exitCode=code;}
function launch(){
 desktop=spawn(require('electron'),['.'],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'development',HISAFLOW_DEV_RUNNER:'1'}});
 desktop.on('error',e=>{console.error(e.message);stop(1)});
 desktop.on('exit',code=>{desktop=null;if(stopping)return;if(code===75)launch();else stop(code||0)});
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
(async()=>{const {createServer}=await import('vite');server=await createServer({configFile:path.join(root,'vite.config.js'),server:{port:5173,strictPort:true,host:'127.0.0.1'}});await server.listen();server.printUrls();if(!stopping)launch();})().catch(e=>{console.error(e.message);stop(1)});
