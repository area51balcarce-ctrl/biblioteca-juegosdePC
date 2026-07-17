function json(res, status, body){
  res.status(status)
    .setHeader('Content-Type','application/json; charset=utf-8')
    .setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400')
    .send(JSON.stringify(body));
}

function normalize(value=''){
  return String(value)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(official|trailer|launch|gameplay|teaser|announcement|4k|hd)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function collectVideoRenderers(node, output=[]){
  if(!node || typeof node !== 'object') return output;
  if(node.videoRenderer?.videoId){
    const renderer = node.videoRenderer;
    const title = renderer.title?.runs?.map(item => item.text).join('') || renderer.title?.simpleText || '';
    output.push({ videoId:renderer.videoId, title });
  }
  if(node.gridVideoRenderer?.videoId){
    const renderer = node.gridVideoRenderer;
    const title = renderer.title?.runs?.map(item => item.text).join('') || renderer.title?.simpleText || '';
    output.push({ videoId:renderer.videoId, title });
  }
  for(const value of Object.values(node)) collectVideoRenderers(value, output);
  return output;
}

function score(title, query){
  const a = normalize(title);
  const b = normalize(query);
  if(!a || !b) return 0;
  let points = 0;
  if(a === b) points += 100;
  if(a.includes(b)) points += 70;
  const words = b.split(' ').filter(word => word.length > 1);
  points += words.filter(word => a.includes(word)).length * 10;
  if(/official trailer|launch trailer|announcement trailer/i.test(title)) points += 15;
  return points;
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET') return json(res,405,{error:'Método no permitido'});
  const query = String(req.query.q || '').trim();
  if(query.length < 2) return json(res,400,{error:'Nombre de juego inválido'});

  const url = `https://www.youtube.com/@GameTrailers/search?query=${encodeURIComponent(query)}`;

  try{
    const response = await fetch(url, {
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept-Language':'en-US,en;q=0.9'
      }
    });
    if(!response.ok) return json(res,200,{found:false,trailerUrl:'',source:'GameTrailers'});

    const html = await response.text();
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)
      || html.match(/window\["ytInitialData"\] = (\{.*?\});/s)
      || html.match(/ytInitialData"\s*:\s*(\{.*?\})\s*,\s*"ytInitialPlayerResponse"/s);

    if(!match) return json(res,200,{found:false,trailerUrl:'',source:'GameTrailers'});

    let data;
    try{ data = JSON.parse(match[1]); }
    catch{ return json(res,200,{found:false,trailerUrl:'',source:'GameTrailers'}); }

    const videos = collectVideoRenderers(data)
      .map(video => ({...video, score:score(video.title, query)}))
      .filter(video => video.score >= 20)
      .sort((a,b) => b.score - a.score);

    const selected = videos[0];
    if(!selected) return json(res,200,{found:false,trailerUrl:'',source:'GameTrailers'});

    return json(res,200,{
      found:true,
      trailerUrl:`https://www.youtube.com/watch?v=${selected.videoId}`,
      title:selected.title,
      source:'GameTrailers'
    });
  }catch(error){
    console.error(error);
    return json(res,200,{found:false,trailerUrl:'',source:'GameTrailers'});
  }
};
