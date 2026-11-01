// Vista previa de metadatos JSON-LD. No descarga torrents, magnets ni escribe en Supabase.
export default async function handler(req,res){
res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
try{const input=String(req.query.url||'');if(input.length>500)return res.status(400).json({error:'URL demasiado larga'});
const url=new URL(input);if(url.protocol!=='https:'||url.hostname!=='www.gamestorrents.app'||url.port||url.username||url.password||!/^\/juegos-pc\/[a-z0-9-]+\/$/.test(url.pathname))return res.status(400).json({error:'Solo fichas individuales del dominio autorizado'});
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);let response;
try{response=await fetch(url.href,{signal:controller.signal,redirect:'error',headers:{'Accept':'text/html','User-Agent':'AREA51-MetadataPreview/1.0'}});}finally{clearTimeout(timer)}
if(!response.ok)return res.status(502).json({error:'La fuente respondió '+response.status});
const type=response.headers.get('content-type')||'';if(!type.includes('text/html'))return res.status(422).json({error:'La fuente no entregó HTML'});
const reader=response.body.getReader();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1500000){await reader.cancel();return res.status(413).json({error:'HTML demasiado grande'})}chunks.push(value)}
const html=new TextDecoder().decode(Buffer.concat(chunks.map(c=>Buffer.from(c))));
const scripts=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];let game=null;for(const match of scripts){try{const parsed=JSON.parse(match[1]);const entries=Array.isArray(parsed)?parsed:[parsed];game=entries.find(x=>x&&x['@type']==='VideoGame')||game;}catch{}}
if(!game)return res.status(422).json({error:'No se encontró JSON-LD VideoGame en la ficha'});
const string=x=>typeof x==='string'?x.slice(0,3000):'';const image=string(typeof game.image==='string'?game.image:'');const safeImage=(()=>{try{const u=new URL(image);return u.protocol==='https:'?u.href:''}catch{return ''}})();
return res.status(200).json({name:string(game.name),description:string(game.description),genre:Array.isArray(game.genre)?game.genre.filter(x=>typeof x==='string').slice(0,12):[],image:safeImage,igdb:string(game.sameAs),url:url.href});
}catch(e){return res.status(502).json({error:'No se pudo analizar la ficha: '+(e.name==='AbortError'?'tiempo de espera agotado':'fuente inaccesible o respuesta inválida')})}
}