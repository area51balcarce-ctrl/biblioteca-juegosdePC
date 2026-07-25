const GITHUB_API = 'https://api.github.com';
const REPOSITORY = 'microsoft/winget-pkgs';
const WINGET_INDEX_API = 'https://api.winget.run/v2';

function send(res, status, body){
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store')
    .send(JSON.stringify(body));
}

function githubHeaders(token){
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'AREA51-Software-Catalog'
  };
}

async function githubJson(path, token){
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(token)
  });

  if(!response.ok){
    const detail = await response.text().catch(() => '');
    throw new Error(
      `GitHub respondió ${response.status}${detail ? `: ${detail.slice(0,180)}` : ''}`
    );
  }

  return response.json();
}

async function wingetIndexJson(path){
  const response = await fetch(`${WINGET_INDEX_API}${path}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'AREA51-Software-Catalog'
    }
  });

  if(!response.ok){
    const detail = await response.text().catch(() => '');
    throw new Error(
      `El índice WinGet respondió ${response.status}${detail ? `: ${detail.slice(0,180)}` : ''}`
    );
  }

  return response.json();
}

async function githubText(url, token){
  const response = await fetch(url, {
    headers: githubHeaders(token)
  });

  if(!response.ok){
    const detail = await response.text().catch(() => '');
    throw new Error(
      `No se pudo leer el manifiesto (${response.status})${detail ? `: ${detail.slice(0,180)}` : ''}`
    );
  }

  const contentType = response.headers.get('content-type') || '';

  // Los resultados de Search Code apuntan a un endpoint JSON de GitHub,
  // no directamente al contenido YAML.
  if(contentType.includes('application/json')){
    const json = await response.json();

    if(json.content && json.encoding === 'base64'){
      return Buffer.from(
        String(json.content).replace(/\n/g, ''),
        'base64'
      ).toString('utf8');
    }

    if(json.download_url){
      const rawResponse = await fetch(json.download_url, {
        headers: {
          'Accept': 'text/plain',
          'User-Agent': 'AREA51-Software-Catalog'
        }
      });

      if(!rawResponse.ok){
        throw new Error(
          `No se pudo descargar el manifiesto (${rawResponse.status}).`
        );
      }

      return rawResponse.text();
    }

    throw new Error('GitHub no devolvió el contenido del manifiesto.');
  }

  return response.text();
}

function decodeYamlScalar(value=''){
  const text = String(value).trim();

  if(
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ){
    return text.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/''/g, "'");
  }

  return text;
}

function parseSimpleYaml(yaml=''){
  const result = {};
  const lines = String(yaml).replace(/\r\n/g, '\n').split('\n');

  let currentKey = '';
  let currentIndent = -1;
  let blockMode = '';
  let blockLines = [];

  function flushBlock(){
    if(!currentKey) return;
    result[currentKey] = blockLines.join('\n').trim();
    currentKey = '';
    currentIndent = -1;
    blockMode = '';
    blockLines = [];
  }

  for(const rawLine of lines){
    const indent = rawLine.match(/^\s*/)?.[0].length || 0;
    const trimmed = rawLine.trim();

    if(!trimmed || trimmed.startsWith('#')){
      if(blockMode && currentKey) blockLines.push('');
      continue;
    }

    if(blockMode){
      if(indent > currentIndent){
        blockLines.push(rawLine.slice(Math.min(rawLine.length, currentIndent + 2)));
        continue;
      }
      flushBlock();
    }

    const match = rawLine.match(/^(\s*)([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/);
    if(!match) continue;

    const key = match[2];
    const value = match[3] ?? '';

    if(value === '|' || value === '>-' || value === '>' || value === '|-'){
      currentKey = key;
      currentIndent = indent;
      blockMode = value;
      blockLines = [];
      continue;
    }

    if(value !== ''){
      result[key] = decodeYamlScalar(value);
    }
  }

  flushBlock();
  return result;
}

function parseYamlList(yaml='', key='Tags'){
  const lines = String(yaml).replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let inside = false;
  let baseIndent = -1;

  for(const rawLine of lines){
    const indent = rawLine.match(/^\s*/)?.[0].length || 0;
    const trimmed = rawLine.trim();

    if(!inside){
      if(new RegExp(`^${key}:\\s*$`).test(trimmed)){
        inside = true;
        baseIndent = indent;
      }
      continue;
    }

    if(trimmed && indent <= baseIndent && !trimmed.startsWith('-')){
      break;
    }

    const item = trimmed.match(/^-\s*(.+)$/);
    if(item) output.push(decodeYamlScalar(item[1]));
  }

  return output;
}

function normalizeText(value=''){
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function translateToSpanish(text, apiKey){
  const original = normalizeText(text);
  if(!original || !apiKey) return original;

  const endpoint = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  try{
    const body = new URLSearchParams();
    body.set('text', original);
    body.set('target_lang', 'ES');
    body.set('preserve_formatting', '1');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if(!response.ok){
      const detail = await response.text().catch(() => '');
      console.warn(`DeepL respondió ${response.status}: ${detail.slice(0,160)}`);
      return original;
    }

    const json = await response.json();
    return normalizeText(json?.translations?.[0]?.text || original);
  }catch(error){
    console.warn('DeepL no disponible; se conserva la descripción original.', error);
    return original;
  }
}

function inferSoftwareCategory({
  id='',
  name='',
  publisher='',
  description='',
  tags=[]
}={}){
  const searchable = normalizeTitle([
    id,
    name,
    publisher,
    description,
    ...(Array.isArray(tags) ? tags : [])
  ].join(' '));

  const exactRules = [
    ['Streaming y grabación', /\b(obsproject|obs studio|streamlabs|xsplit|screen recorder|screen capture|broadcast|livestream|live streaming|recording)\b/],
    ['Comunicación', /\b(discord|telegram|whatsapp|slack|zoom|microsoft teams|teamspeak|messaging|communication|voice chat|video call|conference)\b/],
    ['Programación', /\b(visualstudiocode|visual studio code|vscode|code editor|source code editor|ide|compiler|developer tools|development environment|programming)\b/],
    ['Modelado 3D y CAD', /\b(blender|autocad|freecad|sketchup|solidworks|3d modeling|3d modelling|computer aided design|cad)\b/],
    ['Multimedia', /\b(videolan|vlc|media player|multimedia player|video player|audio player|playback|codec|dvd|vcd|blu ray)\b/],
    ['Navegadores', /\b(google chrome|mozilla firefox|microsoft edge|brave browser|opera browser|vivaldi|tor browser|web browser|navegador)\b/],
    ['Audio', /\b(audacity|foobar|music player|audio editor|sound editor|music production|digital audio workstation|daw|equalizer|podcast)\b/],
    ['Edición de video', /\b(davinci resolve|adobe premiere|shotcut|kdenlive|openshot|handbrake|video editor|video editing)\b/],
    ['Diseño gráfico', /\b(adobe photoshop|gimp|krita|inkscape|photo editor|image editor|graphic design|illustration|vector graphics)\b/],
    ['Ofimática', /\b(microsoft office|libreoffice|onlyoffice|spreadsheet|word processor|presentation software|document editor|pdf editor)\b/],
    ['Bases de datos', /\b(mysql|postgresql|sqlite|mongodb|dbeaver|database|sql client|database manager)\b/],
    ['Inteligencia artificial', /\b(stable diffusion|ollama|comfyui|machine learning|artificial intelligence|large language model|llm|ai tool|chatbot)\b/],
    ['Compresión', /\b(7 zip|7zip|winrar|peazip|archive manager|archiver|compression|compressor|zip|rar)\b/],
    ['Seguridad', /\b(antivirus|anti malware|firewall|password manager|vpn|encryption|security|privacy|authenticator)\b/],
    ['Redes e Internet', /\b(remote desktop|file transfer protocol|ftp client|ssh client|network monitor|networking|proxy|dns|wifi|wi fi|lan)\b/],
    ['Descargas', /\b(jdownloader|qbittorrent|bittorrent|torrent client|download manager)\b/],
    ['Copias de seguridad', /\b(backup|restore|recovery|disk image|disk clone|file synchronization)\b/],
    ['Mantenimiento y sistema', /\b(system utility|system tool|cleanup|optimizer|hardware monitor|benchmark|driver updater|maintenance)\b/],
    ['Virtualización', /\b(vmware|virtualbox|hyper v|virtual machine|virtualization)\b/],
    ['Emulación', /\b(retroarch|dolphin emulator|pcsx|rpcs3|xenia|yuzu|ryujinx|emulator|emulation)\b/],
    ['Plataformas de juegos', /\b(steam client|epic games launcher|gog galaxy|ubisoft connect|battle net|ea app|game launcher|gaming platform)\b/],
    ['Educación', /\b(education|learning|study|classroom|language learning|training software)\b/],
    ['Finanzas', /\b(accounting|budget|invoice|billing|banking|trading|cryptocurrency|finance)\b/],
    ['Productividad', /\b(task manager|note taking|calendar|organizer|project management|pomodoro|productivity)\b/]
  ];

  for(const [category, pattern] of exactRules){
    if(pattern.test(searchable)) return category;
  }

  return 'Software de PC';
}


function decodeHtmlEntities(value=''){
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function absoluteUrl(value='', base=''){
  try{
    return new URL(decodeHtmlEntities(value), base).toString();
  }catch{
    return '';
  }
}

function extractMetaContent(html='', key=''){
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, 'i')
  ];

  for(const pattern of patterns){
    const match = String(html).match(pattern);
    if(match?.[1]) return decodeHtmlEntities(match[1]);
  }

  return '';
}

function extractLinkHref(html='', relValue=''){
  const escaped = relValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]+href=["']([^"']+)["']`, 'i'),
    new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${escaped}[^"']*["']`, 'i')
  ];

  for(const pattern of patterns){
    const match = String(html).match(pattern);
    if(match?.[1]) return decodeHtmlEntities(match[1]);
  }

  return '';
}

async function fetchHomepageMetadata(homepage=''){
  if(!homepage) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try{
    const response = await fetch(homepage, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 AREA51-Software-Catalog'
      }
    });

    if(!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if(!contentType.includes('text/html')) return null;

    const html = await response.text();
    const finalUrl = response.url || homepage;

    const imageCandidates = [
      extractMetaContent(html, 'og:image:secure_url'),
      extractMetaContent(html, 'og:image'),
      extractMetaContent(html, 'twitter:image'),
      extractMetaContent(html, 'twitter:image:src'),
      extractLinkHref(html, 'apple-touch-icon'),
      extractLinkHref(html, 'icon')
    ]
      .map(value => absoluteUrl(value, finalUrl))
      .filter(Boolean);

    return {
      finalUrl,
      imageCandidates: [...new Set(imageCandidates)],
      description:
        extractMetaContent(html, 'og:description') ||
        extractMetaContent(html, 'twitter:description') ||
        extractMetaContent(html, 'description') ||
        ''
    };
  }catch(error){
    console.warn('No se pudieron leer metadatos del sitio oficial.', error.message);
    return null;
  }finally{
    clearTimeout(timeout);
  }
}

function officialRecommendedRequirements(packageId='', name=''){
  const id = String(packageId).toLowerCase();
  const title = normalizeTitle(name);

  const known = new Map([
    ['obsproject.obsstudio', [
      'Windows 10 u 11 de 64 bits',
      'Procesador Intel Core i5 o AMD Ryzen 5 equivalente',
      '8 GB de RAM',
      'GPU compatible con DirectX 11'
    ].join('\\n')],
    ['blenderfoundation.blender', [
      'Windows 10 u 11 de 64 bits',
      'Procesador de 8 núcleos',
      '32 GB de RAM',
      'GPU con 8 GB de VRAM compatible con OpenGL 4.3'
    ].join('\\n')],
    ['microsoft.visualstudiocode', [
      'Windows 10 u 11 de 64 bits',
      'Procesador de 1,6 GHz o superior',
      '4 GB de RAM',
      'SSD recomendado'
    ].join('\\n')],
    ['videolan.vlc', [
      'Windows 10 u 11',
      'Procesador de doble núcleo',
      '2 GB de RAM',
      '100 MB de espacio disponible'
    ].join('\\n')],
    ['discord.discord', [
      'Windows 10 u 11 de 64 bits',
      'Procesador de doble núcleo',
      '4 GB de RAM',
      'Conexión a Internet estable'
    ].join('\\n')]
  ]);

  if(known.has(id)) return known.get(id);
  if(/\bobs studio\b/.test(title)) return known.get('obsproject.obsstudio');
  if(/\bblender\b/.test(title)) return known.get('blenderfoundation.blender');
  if(/\bvisual studio code\b|\bvs code\b/.test(title)) return known.get('microsoft.visualstudiocode');
  if(/\bvlc\b/.test(title)) return known.get('videolan.vlc');
  if(/\bdiscord\b/.test(title)) return known.get('discord.discord');

  return '';
}

function fallbackCoverUrl(homepage=''){
  try{
    const url = new URL(homepage);
    return `${url.origin}/favicon.ico`;
  }catch{
    return '';
  }
}

function resolveWebUrl(value='', baseUrl=''){
  const clean = String(value || '').trim();
  if(!clean) return '';

  try{
    const resolved = new URL(clean, baseUrl);
    return /^https?:$/i.test(resolved.protocol) ? resolved.toString() : '';
  }catch{
    return '';
  }
}

function extractMetaContent(html='', property=''){
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      'i'
    )
  ];

  for(const pattern of patterns){
    const match = String(html).match(pattern);
    if(match?.[1]) return match[1].replace(/&amp;/gi, '&').trim();
  }

  return '';
}

function extractLinkHref(html='', relPattern=''){
  const patterns = [
    new RegExp(
      `<link[^>]+rel=["'][^"']*${relPattern}[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${relPattern}[^"']*["'][^>]*>`,
      'i'
    )
  ];

  for(const pattern of patterns){
    const match = String(html).match(pattern);
    if(match?.[1]) return match[1].replace(/&amp;/gi, '&').trim();
  }

  return '';
}

async function getOfficialLargeCover(homepage=''){
  const pageUrl = resolveWebUrl(homepage);
  if(!pageUrl) return '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try{
    const response = await fetch(pageUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 AREA51-Software-Catalog'
      }
    });

    if(!response.ok) return '';

    const contentType = response.headers.get('content-type') || '';
    if(!contentType.includes('text/html')) return '';

    const html = (await response.text()).slice(0, 750000);
    const finalUrl = response.url || pageUrl;

    const candidates = [
      extractMetaContent(html, 'og:image:secure_url'),
      extractMetaContent(html, 'og:image'),
      extractMetaContent(html, 'twitter:image'),
      extractMetaContent(html, 'twitter:image:src'),
      extractLinkHref(html, 'apple-touch-icon'),
      extractLinkHref(html, 'icon')
    ];

    for(const candidate of candidates){
      const resolved = resolveWebUrl(candidate, finalUrl);
      if(resolved) return resolved;
    }

    return '';
  }catch(error){
    console.warn(
      `No se pudo obtener una imagen grande desde ${pageUrl}.`,
      error.message
    );
    return '';
  }finally{
    clearTimeout(timeout);
  }
}

function normalizeTitle(value=''){
  return String(value)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compareVersions(a='', b=''){
  const tokenize = value => String(value)
    .replace(/^v/i, '')
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean)
    .map(part => /^\d+$/.test(part) ? Number(part) : part.toLowerCase());

  const left = tokenize(a);
  const right = tokenize(b);
  const length = Math.max(left.length, right.length);

  for(let i = 0; i < length; i++){
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;

    if(typeof x === 'number' && typeof y === 'number'){
      if(x !== y) return x > y ? 1 : -1;
      continue;
    }

    const comparison = String(x).localeCompare(String(y), undefined, {
      numeric: true,
      sensitivity: 'base'
    });

    if(comparison !== 0) return comparison > 0 ? 1 : -1;
  }

  return 0;
}

function extractVersionFromPath(path=''){
  const parts = String(path).split('/');
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

function scoreSearchResult(item, query){
  const data = item.data || {};
  const wanted = normalizeTitle(query);
  const name = normalizeTitle(data.PackageName || '');
  const identifier = normalizeTitle(data.PackageIdentifier || '');

  let score = 0;
  if(name === wanted) score += 100;
  if(identifier === wanted) score += 90;
  if(name.startsWith(wanted)) score += 50;
  if(identifier.includes(wanted)) score += 35;
  if(name.includes(wanted)) score += 30;
  if(/\.locale\.[a-z-]+\.yaml$/i.test(item.path)) score += 5;

  return score;
}

async function searchManifests(query, token){
  const normalizedQuery = String(query).trim();

  // winget.run mantiene un índice preparado para búsquedas. Se usa únicamente
  // para localizar PackageIdentifier. La ficha completa continúa leyéndose
  // desde el repositorio oficial microsoft/winget-pkgs.
  try{
    const params = new URLSearchParams({
      query: normalizedQuery,
      ensureContains: 'true',
      take: '12'
    });

    const json = await wingetIndexJson(`/packages?${params.toString()}`);
    const packages = Array.isArray(json?.Packages) ? json.Packages : [];

    return packages
      .map(item => {
        const latest = item?.Latest || {};
        return {
          path: '',
          htmlUrl: '',
          yaml: '',
          data: {
            PackageIdentifier: item?.Id || '',
            PackageName: latest?.Name || item?.Id || '',
            Publisher: latest?.Publisher || '',
            PackageVersion:
              Array.isArray(item?.Versions) && item.Versions.length
                ? item.Versions[0]
                : '',
            ShortDescription: latest?.Description || '',
            Description: latest?.Description || '',
            PackageUrl: latest?.Homepage || '',
            License: latest?.License || '',
            LicenseUrl: latest?.LicenseUrl || ''
          },
          version:
            Array.isArray(item?.Versions) && item.Versions.length
              ? item.Versions[0]
              : '',
          coverUrl:
            item?.Logo ||
            item?.IconUrl ||
            item?.Banner ||
            ''
        };
      })
      .filter(item =>
        item.data.PackageIdentifier &&
        item.data.PackageName
      )
      .sort((a, b) => {
        const scoreDifference =
          scoreSearchResult(b, normalizedQuery) -
          scoreSearchResult(a, normalizedQuery);

        if(scoreDifference) return scoreDifference;

        return String(a.data.PackageName)
          .localeCompare(String(b.data.PackageName));
      })
      .slice(0, 8);
  }catch(indexError){
    console.warn(
      'El índice de búsqueda WinGet no está disponible; se intenta el respaldo de GitHub.',
      indexError.message
    );
  }

  // Respaldo: GitHub Code Search. Puede no devolver resultados en todos los
  // casos debido al tamaño del repositorio, pero evita que el endpoint falle.
  const encoded = encodeURIComponent(
    `${normalizedQuery} in:path repo:${REPOSITORY} path:manifests extension:yaml`
  );

  const search = await githubJson(
    `/search/code?q=${encoded}&per_page=50`,
    token
  );

  const candidates = [];

  for(const item of search.items || []){
    try{
      const yaml = await githubText(item.url, token);
      const data = parseSimpleYaml(yaml);

      if(!data.PackageIdentifier || !data.PackageName) continue;

      candidates.push({
        path: item.path,
        htmlUrl: item.html_url,
        yaml,
        data,
        version:
          data.PackageVersion ||
          extractVersionFromPath(item.path)
      });
    }catch(error){
      console.warn(
        'No se pudo leer un resultado WinGet desde GitHub.',
        error.message
      );
    }
  }

  const grouped = new Map();

  for(const candidate of candidates){
    const id = candidate.data.PackageIdentifier;
    const existing = grouped.get(id);

    if(
      !existing ||
      compareVersions(candidate.version, existing.version) > 0 ||
      (
        compareVersions(candidate.version, existing.version) === 0 &&
        scoreSearchResult(candidate, normalizedQuery) >
          scoreSearchResult(existing, normalizedQuery)
      )
    ){
      grouped.set(id, candidate);
    }
  }

  return [...grouped.values()]
    .sort((a, b) => {
      const scoreDifference =
        scoreSearchResult(b, normalizedQuery) -
        scoreSearchResult(a, normalizedQuery);

      if(scoreDifference) return scoreDifference;

      return String(a.data.PackageName)
        .localeCompare(String(b.data.PackageName));
    })
    .slice(0, 8);
}

async function findPackageManifest(packageId, token){
  const encoded = encodeURIComponent(
    `"PackageIdentifier: ${packageId}" repo:${REPOSITORY} path:manifests extension:yaml`
  );

  const search = await githubJson(
    `/search/code?q=${encoded}&per_page=50`,
    token
  );

  const matches = [];

  for(const item of search.items || []){
    try{
      const yaml = await githubText(item.url, token);
      const data = parseSimpleYaml(yaml);

      if(data.PackageIdentifier !== packageId) continue;

      matches.push({
        path: item.path,
        htmlUrl: item.html_url,
        yaml,
        data,
        version: data.PackageVersion || extractVersionFromPath(item.path)
      });
    }catch(error){
      console.warn('No se pudo leer un manifiesto WinGet.', error.message);
    }
  }

  if(!matches.length) return null;

  matches.sort((a, b) => compareVersions(b.version, a.version));
  const latestVersion = matches[0].version;
  const latest = matches.filter(item => item.version === latestVersion);

  const locale =
    latest.find(item => /\.locale\.es(?:-[a-z]+)?\.yaml$/i.test(item.path)) ||
    latest.find(item => /\.locale\.en-us\.yaml$/i.test(item.path)) ||
    latest.find(item => /\.locale\.[a-z-]+\.yaml$/i.test(item.path)) ||
    latest.find(item => !/\.installer\.yaml$/i.test(item.path));

  const version =
    latest.find(item => /\.yaml$/i.test(item.path) &&
      !/\.locale\.[a-z-]+\.yaml$/i.test(item.path) &&
      !/\.installer\.yaml$/i.test(item.path)) ||
    locale ||
    latest[0];

  const installer =
    latest.find(item => /\.installer\.yaml$/i.test(item.path)) ||
    null;

  return {
    latestVersion,
    locale,
    version,
    installer,
    files: latest
  };
}

function joinUnique(values){
  return [...new Set(
    values
      .flatMap(value => Array.isArray(value) ? value : [value])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )];
}

function inferLanguages(manifests){
  const locales = manifests
    .map(item => item?.PackageLocale)
    .filter(Boolean)
    .map(locale => {
      const normalized = String(locale).toLowerCase();
      if(normalized.startsWith('es')) return 'Español';
      if(normalized.startsWith('en')) return 'Inglés';
      if(normalized.startsWith('pt')) return 'Portugués';
      if(normalized.startsWith('fr')) return 'Francés';
      if(normalized.startsWith('de')) return 'Alemán';
      if(normalized.startsWith('it')) return 'Italiano';
      return locale;
    });

  return joinUnique(locales).join(', ');
}

function inferLegalBasis(data){
  const license = `${data.License || ''} ${data.LicenseUrl || ''}`.toLowerCase();

  if(
    /mit|apache|gpl|gnu|mozilla public|bsd|open source|opensource/
      .test(license)
  ){
    return 'dominio-publico';
  }

  if(/shareware|trial|prueba/.test(license)){
    return 'shareware';
  }

  return 'freeware';
}



function encodeRepositoryPath(path=''){
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/');
}

async function getRepositoryContents(path, token){
  return githubJson(
    `/repos/${REPOSITORY}/contents/${encodeRepositoryPath(path)}`,
    token
  );
}

function packageVersionPath(packageId='', version=''){
  const parts = String(packageId).split('.').filter(Boolean);
  if(parts.length < 2 || !version) return '';

  return [
    'manifests',
    parts[0].charAt(0).toLowerCase(),
    ...parts,
    version
  ].join('/');
}

function mapLocaleName(locale=''){
  const value = String(locale).toLowerCase();

  if(value.startsWith('es')) return 'Español';
  if(value.startsWith('en')) return 'Inglés';
  if(value.startsWith('pt')) return 'Portugués';
  if(value.startsWith('fr')) return 'Francés';
  if(value.startsWith('de')) return 'Alemán';
  if(value.startsWith('it')) return 'Italiano';
  if(value.startsWith('ja')) return 'Japonés';
  if(value.startsWith('ko')) return 'Coreano';
  if(value.startsWith('zh')) return 'Chino';
  if(value.startsWith('ru')) return 'Ruso';
  if(value.startsWith('nl')) return 'Neerlandés';
  if(value.startsWith('pl')) return 'Polaco';
  if(value.startsWith('tr')) return 'Turco';

  return locale;
}

function extractYamlValue(yaml='', key=''){
  const pattern = new RegExp(
    `^\\s*${key}:\\s*(.+?)\\s*$`,
    'mi'
  );
  const match = String(yaml).match(pattern);
  return match ? decodeYamlScalar(match[1]) : '';
}

function extractInstallerUrls(yaml=''){
  return [...String(yaml).matchAll(
    /^\s*InstallerUrl:\s*(.+?)\s*$/gmi
  )].map(match => decodeYamlScalar(match[1])).filter(Boolean);
}

function formatBytes(bytes){
  const value = Number(bytes || 0);
  if(!Number.isFinite(value) || value <= 0) return '';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;

  while(size >= 1024 && index < units.length - 1){
    size /= 1024;
    index++;
  }

  const decimals = index >= 3 ? 2 : index >= 2 ? 1 : 0;
  return `${size.toFixed(decimals)} ${units[index]}`;
}

async function getRemoteFileSize(url=''){
  if(!url) return '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try{
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AREA51-Software-Catalog'
      }
    });

    if(!response.ok) return '';

    const contentLength = response.headers.get('content-length');
    return contentLength ? formatBytes(contentLength) : '';
  }catch{
    return '';
  }finally{
    clearTimeout(timeout);
  }
}


function parseRecommendedRequirementsFromText(...values){
  const text = normalizeText(values.filter(Boolean).join('\n'));
  if(!text) return '';

  const lines = [];

  const windows = text.match(/(?:recommended|recomendado|recommended os|sistema operativo recomendado)[^.\n]{0,80}(Windows\s+(?:10|11)(?:\s*64[- ]?bit)?)/i);
  if(windows) lines.push(windows[1]);

  const ram = text.match(/(?:recommended|recomendado|memory|memoria|ram)[^0-9\n]{0,40}(\d+(?:[.,]\d+)?)\s*(GB|MB)\s*(?:RAM)?/i);
  if(ram) lines.push(`${ram[1].replace(',','.')} ${ram[2].toUpperCase()} de RAM`);

  const cpu = text.match(/(?:recommended|recomendado|processor|procesador|cpu)[^.\n]{0,100}((?:Intel|AMD|Apple|ARM)[^.\n]{2,80}|\d+(?:[.,]\d+)?\s*GHz[^.\n]{0,50})/i);
  if(cpu) lines.push(`Procesador: ${cpu[1].trim()}`);

  const storage = text.match(/(?:recommended|recomendado|storage|almacenamiento|disk space|espacio)[^0-9\n]{0,50}(\d+(?:[.,]\d+)?)\s*(GB|MB|TB)/i);
  if(storage) lines.push(`${storage[1].replace(',','.')} ${storage[2].toUpperCase()} de espacio disponible`);

  const graphics = text.match(/(?:recommended|recomendado|graphics|gráficos|gpu)[^.\n]{0,100}((?:NVIDIA|AMD|Intel|DirectX|OpenGL)[^.\n]{2,90})/i);
  if(graphics) lines.push(`Gráficos: ${graphics[1].trim()}`);

  return joinUnique(lines).join('\n');
}

async function loadOfficialManifestData(packageId, version, token){
  const path = packageVersionPath(packageId, version);
  if(!path) return null;

  try{
    const entries = await getRepositoryContents(path, token);
    if(!Array.isArray(entries)) return null;

    const yamlFiles = entries.filter(item =>
      item?.type === 'file' &&
      /\.ya?ml$/i.test(item.name || '')
    );

    const files = [];

    for(const item of yamlFiles){
      try{
        const yaml = await githubText(item.url, token);
        files.push({
          name: item.name,
          path: item.path,
          htmlUrl: item.html_url,
          yaml,
          data: parseSimpleYaml(yaml)
        });
      }catch(error){
        console.warn(
          `No se pudo leer ${item.name}.`,
          error.message
        );
      }
    }

    if(!files.length) return null;

    const spanishLocale =
      files.find(item => /\.locale\.es(?:-[a-z]+)?\.ya?ml$/i.test(item.name));

    const englishLocale =
      files.find(item => /\.locale\.en-us\.ya?ml$/i.test(item.name));

    const anyLocale =
      files.find(item => /\.locale\.[a-z-]+\.ya?ml$/i.test(item.name));

    const localeFile = spanishLocale || englishLocale || anyLocale || null;
    const installerFile =
      files.find(item => /\.installer\.ya?ml$/i.test(item.name)) || null;

    const baseFile =
      files.find(item =>
        !/\.installer\.ya?ml$/i.test(item.name) &&
        !/\.locale\.[a-z-]+\.ya?ml$/i.test(item.name)
      ) || null;

    const localeValues = files
      .map(item => item.data?.PackageLocale)
      .filter(Boolean)
      .map(mapLocaleName);

    const installerLocales = installerFile
      ? [...installerFile.yaml.matchAll(
          /^\s*InstallerLocale:\s*(.+?)\s*$/gmi
        )].map(match => mapLocaleName(decodeYamlScalar(match[1])))
      : [];

    const languages = joinUnique([
      localeValues,
      installerLocales
    ]).join(', ');

    const installerYaml = installerFile?.yaml || '';
    const installerUrls = extractInstallerUrls(installerYaml);
    const size = await getRemoteFileSize(installerUrls[0] || '');

    const minimumOSVersion =
      extractYamlValue(installerYaml, 'MinimumOSVersion');

    const architecture =
      extractYamlValue(installerYaml, 'Architecture');

    const installerType =
      extractYamlValue(installerYaml, 'InstallerType');

    const reqMinParts = [
      minimumOSVersion ? `Windows ${minimumOSVersion} o superior` : '',
      architecture && architecture !== 'neutral'
        ? `Arquitectura: ${architecture}`
        : '',
      installerType ? `Tipo de instalador: ${installerType}` : ''
    ].filter(Boolean);

    const releaseNotes = normalizeText(
      localeFile?.data?.ReleaseNotes ||
      baseFile?.data?.ReleaseNotes ||
      ''
    );

    const releaseNotesUrl =
      localeFile?.data?.ReleaseNotesUrl ||
      baseFile?.data?.ReleaseNotesUrl ||
      '';

    const recommendedRequirements = parseRecommendedRequirementsFromText(
      localeFile?.data?.Description,
      localeFile?.data?.ShortDescription,
      localeFile?.data?.ReleaseNotes,
      baseFile?.data?.Description,
      baseFile?.data?.ShortDescription,
      baseFile?.data?.ReleaseNotes
    );

    return {
      languages,
      size,
      reqMin: reqMinParts.join('\n'),
      reqRec: recommendedRequirements,
      changelog: releaseNotes,
      releaseNotesUrl,
      manifestUrl:
        localeFile?.htmlUrl ||
        baseFile?.htmlUrl ||
        installerFile?.htmlUrl ||
        '',
      installerUrl: installerUrls[0] || ''
    };
  }catch(error){
    console.warn(
      `No se pudo enriquecer ${packageId} desde el manifiesto oficial.`,
      error.message
    );
    return null;
  }
}

function splitPackageIdentifier(packageId=''){
  const parts = String(packageId).split('.').filter(Boolean);
  if(parts.length < 2) return null;

  return {
    publisher: parts.shift(),
    packageName: parts.join('.')
  };
}

async function buildProductFromIndexPackage(
  packageInfo={},
  deeplApiKey='',
  officialData=null
){
  const latest = packageInfo.Latest || {};
  const packageIdentifier = packageInfo.Id || '';
  const version =
    Array.isArray(packageInfo.Versions) && packageInfo.Versions.length
      ? packageInfo.Versions[0]
      : '';

  const publisher = latest.Publisher || '';
  const license = latest.License || '';
  const homepage = latest.Homepage || '';
  const rawTags = Array.isArray(latest.Tags) ? latest.Tags : [];
  const tags = joinUnique([rawTags, publisher]);
  const originalDescription = normalizeText(latest.Description || '');

  const homepageMetadata = await fetchHomepageMetadata(homepage);

  const descriptionSource =
    originalDescription ||
    normalizeText(homepageMetadata?.description || '');

  const description = await translateToSpanish(
    descriptionSource,
    deeplApiKey
  );

  const category = inferSoftwareCategory({
    id: packageIdentifier,
    name: latest.Name || packageIdentifier,
    publisher,
    description: descriptionSource,
    tags: rawTags
  });

  const coverCandidates = joinUnique([
    homepageMetadata?.imageCandidates || [],
    packageInfo.Banner || '',
    packageInfo.Logo || '',
    packageInfo.IconUrl || '',
    fallbackCoverUrl(homepage)
  ]);

  const largeCoverUrl = coverCandidates[0] || '';
  const translatedChangelog = await translateToSpanish(
    officialData?.changelog || '',
    deeplApiKey
  );

  const reqRec =
    officialData?.reqRec ||
    officialRecommendedRequirements(
      packageIdentifier,
      latest.Name || packageIdentifier
    );

  return {
    wingetId: packageIdentifier,
    name: latest.Name || packageIdentifier,
    category,
    status: 'ok',
    legalBasis: inferLegalBasis({
      License: license,
      LicenseUrl: latest.LicenseUrl || ''
    }),
    description,
    reqMin: officialData?.reqMin || '',
    reqRec,
    recommendedRequirements: reqRec,
    size: officialData?.size || '',
    version,
    languages: officialData?.languages || '',
    tags: tags.slice(0, 12).join(', '),
    coverUrl: largeCoverUrl,
    largeCoverUrl,
    coverCandidates,
    install: packageIdentifier
      ? `Instalar desde WinGet: winget install --id ${packageIdentifier} --exact`
      : '',
    notes: [
      publisher ? `Desarrollador/editor: ${publisher}.` : '',
      license ? `Licencia informada por WinGet: ${license}.` : '',
      homepage ? `Sitio oficial informado por WinGet: ${homepage}` : '',
      officialData?.releaseNotesUrl
        ? `Notas oficiales de la versión: ${officialData.releaseNotesUrl}`
        : '',
      !largeCoverUrl
        ? 'No se encontró una imagen oficial verificable para este software.'
        : '',
      !officialData?.reqMin
        ? 'La fuente no informó requisitos mínimos verificables.'
        : '',
      !reqRec
        ? 'La fuente no informó requisitos recomendados verificables.'
        : '',
      !officialData?.size
        ? 'La fuente no permitió verificar automáticamente el tamaño del instalador.'
        : '',
      !officialData?.languages
        ? 'La fuente no informó idiomas verificables.'
        : ''
    ].filter(Boolean).join('\n'),
    changelog: translatedChangelog,
    sourceUrl: homepageMetadata?.finalUrl || homepage,
    contentType: 'software',
    updateMeta: {
      wingetId: packageIdentifier,
      fetchedAt: new Date().toISOString(),
      manifestUrl: officialData?.manifestUrl || '',
      installerUrl: officialData?.installerUrl || '',
      homepageMetadataFound: Boolean(homepageMetadata),
      translatedWithDeepL: Boolean(
        deeplApiKey &&
        description &&
        description !== descriptionSource
      )
    },
    source: [
      'WinGet',
      officialData ? 'Manifiesto oficial' : '',
      homepageMetadata ? 'Sitio oficial' : '',
      deeplApiKey &&
      (
        description !== descriptionSource ||
        translatedChangelog !== (officialData?.changelog || '')
      )
        ? 'DeepL'
        : ''
    ].filter(Boolean).join(' + ')
  };
}

function buildProduct(packageData){
  const localeData = packageData.locale?.data || {};
  const versionData = packageData.version?.data || {};
  const installerData = packageData.installer?.data || {};
  const allData = [localeData, versionData, installerData];

  const packageIdentifier =
    localeData.PackageIdentifier ||
    versionData.PackageIdentifier ||
    installerData.PackageIdentifier ||
    '';

  const packageName =
    localeData.PackageName ||
    versionData.PackageName ||
    installerData.PackageName ||
    packageIdentifier;

  const publisher =
    localeData.Publisher ||
    versionData.Publisher ||
    installerData.Publisher ||
    '';

  const description = normalizeText(
    localeData.Description ||
    versionData.Description ||
    localeData.ShortDescription ||
    versionData.ShortDescription ||
    ''
  );

  const tags = joinUnique([
    parseYamlList(packageData.locale?.yaml || '', 'Tags'),
    parseYamlList(packageData.version?.yaml || '', 'Tags'),
    publisher
  ]);

  const homepage =
    localeData.PackageUrl ||
    versionData.PackageUrl ||
    localeData.PublisherUrl ||
    versionData.PublisherUrl ||
    '';

  const license =
    localeData.License ||
    versionData.License ||
    '';

  return {
    wingetId: packageIdentifier,
    name: packageName,
    category: 'Software de PC',
    status: 'ok',
    legalBasis: inferLegalBasis({...versionData, ...localeData}),
    description,
    reqMin: '',
    reqRec: '',
    size: '',
    version: packageData.latestVersion || versionData.PackageVersion || '',
    languages: inferLanguages(allData),
    tags: tags.slice(0, 12).join(', '),
    coverUrl: '',
    install: packageIdentifier
      ? `Instalar desde WinGet: winget install --id ${packageIdentifier} --exact`
      : '',
    notes: [
      publisher ? `Desarrollador/editor: ${publisher}.` : '',
      license ? `Licencia informada por WinGet: ${license}.` : '',
      homepage ? `Sitio oficial informado por WinGet: ${homepage}` : ''
    ].filter(Boolean).join('\n'),
    sourceUrl: homepage,
    contentType: 'software',
    updateMeta: {
      wingetId: packageIdentifier,
      fetchedAt: new Date().toISOString(),
      manifestUrl:
        packageData.locale?.htmlUrl ||
        packageData.version?.htmlUrl ||
        ''
    },
    source: 'WinGet'
  };
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET'){
    return send(res, 405, {error: 'Método no permitido'});
  }

  const githubToken = process.env.GITHUB_TOKEN || '';
  const deeplApiKey = process.env.DEEPL_API_KEY || '';
  if(!githubToken){
    return send(res, 500, {
      error: 'Falta configurar GITHUB_TOKEN en Vercel.'
    });
  }

  const query = String(req.query.q || '').trim();
  const id = String(req.query.id || '').trim();

  if(!query && !id){
    return send(res, 400, {error: 'Indicá q o id.'});
  }

  try{
    if(query){
      if(query.length < 2){
        return send(res, 400, {
          error: 'La búsqueda debe tener al menos dos caracteres.'
        });
      }

      const manifests = await searchManifests(query, githubToken);

      const results = manifests.map(item => ({
        id: item.data.PackageIdentifier,
        name: item.data.PackageName,
        publisher: item.data.Publisher || '',
        version: item.version || '',
        description:
          item.data.ShortDescription ||
          item.data.Description ||
          '',
        coverUrl: item.coverUrl || '',
        contentType: 'software',
        source: 'WinGet'
      }));

      return send(res, 200, {
        results,
        provider: 'WinGet'
      });
    }

    const packageParts = splitPackageIdentifier(id);

    if(!packageParts){
      return send(res, 400, {
        error: 'El identificador de WinGet no es válido.'
      });
    }

    try{
      const packageResponse = await wingetIndexJson(
        `/packages/${encodeURIComponent(packageParts.publisher)}/${encodeURIComponent(packageParts.packageName)}`
      );

      const packageInfo = packageResponse?.Package || null;

      if(!packageInfo){
        return send(res, 404, {
          error: 'Software no encontrado en WinGet.'
        });
      }

      const packageVersion =
        Array.isArray(packageInfo.Versions) && packageInfo.Versions.length
          ? packageInfo.Versions[0]
          : '';

      const officialData = await loadOfficialManifestData(
        packageInfo.Id || id,
        packageVersion,
        githubToken
      );

      return send(res, 200, {
        product: await buildProductFromIndexPackage(
          packageInfo,
          deeplApiKey,
          officialData
        )
      });
    }catch(indexError){
      if(String(indexError.message).includes('404')){
        return send(res, 404, {
          error: 'Software no encontrado en WinGet.'
        });
      }

      throw indexError;
    }
  }catch(error){
    console.error(error);

    const message = String(error?.message || '');

    if(message.includes('403')){
      return send(res, 502, {
        error: 'GitHub rechazó la consulta. Revisá GITHUB_TOKEN y sus límites.'
      });
    }

    if(message.includes('422')){
      return send(res, 502, {
        error: 'GitHub no pudo procesar la búsqueda de WinGet.'
      });
    }

    return send(res, 500, {
      error: `No se pudo consultar WinGet: ${message || 'Error desconocido'}`
    });
  }
};
