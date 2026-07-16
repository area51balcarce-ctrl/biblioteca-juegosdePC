const IGDB_BASE = 'https://api.igdb.com/v4';
let tokenCache = { token: '', expiresAt: 0 };

function send(res, status, body){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8').send(JSON.stringify(body));
}

function stripHtml(value=''){
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function escapeApicalypse(value=''){
  return String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
}

function coverUrl(imageId, size='cover_big'){
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : '';
}

function parseSteamAppId(url=''){
  const match = String(url).match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match ? match[1] : null;
}

function extractStorage(...texts){
  const joined = texts.filter(Boolean).join(' ');
  const patterns = [
    /(?:storage|almacenamiento|espacio disponible|hard drive|disco duro)[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)/i,
    /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\s*(?:available space|de espacio disponible|de almacenamiento)/i
  ];
  for(const pattern of patterns){
    const match = joined.match(pattern);
    if(match) return `${match[1].replace(',','.')} ${match[2].toUpperCase()}`;
  }
  return '';
}

function normalizeLanguages(html=''){
  const text = stripHtml(html);
  if(!text) return 'Español, Inglés';
  const langs = [];
  if(/spanish|español|castellano/i.test(text)) langs.push('Español');
  if(/english|inglés/i.test(text)) langs.push('Inglés');
  return langs.length ? langs.join(', ') : 'Español, Inglés';
}

async function getAccessToken(clientId, clientSecret){
  if(tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');
  const response = await fetch(url, { method:'POST' });
  if(!response.ok) throw new Error(`Twitch OAuth respondió ${response.status}`);
  const json = await response.json();
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 3600) - 300) * 1000
  };
  return tokenCache.token;
}

async function igdb(endpoint, body, clientId, token){
  const response = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method:'POST',
    headers:{
      'Accept':'application/json',
      'Content-Type':'text/plain',
      'Client-ID':clientId,
      'Authorization':`Bearer ${token}`
    },
    body
  });
  if(!response.ok){
    const text = await response.text().catch(()=> '');
    throw new Error(`IGDB respondió ${response.status}${text ? `: ${text.slice(0,160)}` : ''}`);
  }
  return response.json();
}

async function steamDetails(appId){
  if(!appId) return null;
  try{
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=spanish&cc=ar`);
    if(!response.ok) return null;
    const json = await response.json();
    return json?.[appId]?.success ? json[appId].data : null;
  }catch{ return null; }
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET') return send(res,405,{error:'Método no permitido'});
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if(!clientId || !clientSecret) return send(res,500,{error:'Faltan IGDB_CLIENT_ID y/o IGDB_CLIENT_SECRET en Vercel.'});

  try{
    const token = await getAccessToken(clientId, clientSecret);
    const query = String(req.query.q || '').trim();
    const id = Number(req.query.id || 0);

    if(query){
      const body = `search "${escapeApicalypse(query)}"; fields name,first_release_date,cover.image_id,genres.name,platforms.name; where platforms = (6); limit 8;`;
      const games = await igdb('games', body, clientId, token);
      const results = games.map(game => ({
        id: game.id,
        name: game.name,
        released: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear().toString() : '',
        coverUrl: coverUrl(game.cover?.image_id, 'cover_big'),
        genres: (game.genres || []).map(g => g.name),
        platforms: (game.platforms || []).map(p => p.name)
      }));
      return send(res,200,{results, provider:'IGDB-v2'});
    }

    if(id){
      const body = `fields name,summary,storyline,first_release_date,cover.image_id,genres.name,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,websites.url; where id = ${id}; limit 1;`;
      const games = await igdb('games', body, clientId, token);
      const game = games[0];
      if(!game) return send(res,404,{error:'Juego no encontrado en IGDB.'});

      const steamId = (game.websites || []).map(w => parseSteamAppId(w.url)).find(Boolean) || null;
      const steam = await steamDetails(steamId);
      const steamMin = steam?.pc_requirements?.minimum || '';
      const steamRec = steam?.pc_requirements?.recommended || '';
      const developers = (game.involved_companies || []).filter(x => x.developer).map(x => x.company?.name).filter(Boolean);
      const publishers = (game.involved_companies || []).filter(x => x.publisher).map(x => x.company?.name).filter(Boolean);
      const genres = (game.genres || []).map(g => g.name);

      return send(res,200,{
        product:{
          name: game.name,
          category: 'Juego de PC',
          status: 'ok',
          legalBasis: 'propio',
          description: stripHtml(steam?.short_description || game.summary || game.storyline || ''),
          reqMin: stripHtml(steamMin),
          reqRec: stripHtml(steamRec),
          size: extractStorage(steamMin, steamRec),
          version: '',
          languages: normalizeLanguages(steam?.supported_languages || ''),
          tags: [...genres, ...developers, ...publishers].filter(Boolean).slice(0,10).join(', '),
          coverUrl: steam?.header_image || coverUrl(game.cover?.image_id, 'cover_big'),
          released: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().slice(0,10) : '',
          source: steam ? 'IGDB + Steam' : 'IGDB'
        }
      });
    }

    return send(res,400,{error:'Indicá q o id.'});
  }catch(error){
    console.error(error);
    return send(res,500,{error:`No se pudo consultar IGDB: ${error.message}`});
  }
};
