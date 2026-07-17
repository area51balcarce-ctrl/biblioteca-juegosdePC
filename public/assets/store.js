/* =========================================================
   ÁREA 51 — Capa de datos
   -----------------------------------------------------------
   Habla con Supabase (Postgres + Auth + Storage). Las pantallas
   (dashboard, editor, ficha pública) consumen estas funciones sin
   necesidad de conocer los detalles de Supabase.

   Requiere, cargados ANTES que este archivo:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
     <script src=".../assets/config.js"></script>            (define A51_SUPABASE_URL / A51_SUPABASE_ANON_KEY)
   ========================================================= */

if (!window.A51_SUPABASE_URL || !window.A51_SUPABASE_ANON_KEY) {
  console.error(
    'Falta assets/config.js (o está incompleto). Sin SUPABASE_URL/ANON_KEY ' +
    'el sitio no puede hablar con la base de datos. Ver .env.example.'
  );
}

const A51_CLIENT = window.supabase.createClient(
  window.A51_SUPABASE_URL,
  window.A51_SUPABASE_ANON_KEY
);

const A51_SESSION_COOKIE = 'a51_admin_session';
const A51_SESSION_COOKIE_MAX_AGE = 60 * 60 * 8; // 8 horas

function a51_slugify(text){
  return text
    .toString().toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/* ---------------------------------------------------------
   Auth
   --------------------------------------------------------- */

// Cookie liviana que solo usa el middleware de Vercel (ver middleware.mjs)
// para decidir si sirve el HTML del panel o redirige al login. No es la
// seguridad real: eso lo hacen las políticas RLS sobre cada tabla/archivo.
function a51_setSessionCookie(){
  document.cookie = `${A51_SESSION_COOKIE}=1; path=/; max-age=${A51_SESSION_COOKIE_MAX_AGE}; SameSite=Lax`;
}
function a51_clearSessionCookie(){
  document.cookie = `${A51_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

function a51_translateAuthError(error){
  const msg = (error && error.message || '').toLowerCase();
  if(msg.includes('invalid login credentials')) return 'Usuario o contraseña incorrectos.';
  if(msg.includes('email not confirmed')) return 'Esa cuenta todavía no está confirmada.';
  return 'No se pudo iniciar sesión. Probá de nuevo en unos segundos.';
}

async function a51_signIn(email, password){
  const { data, error } = await A51_CLIENT.auth.signInWithPassword({ email, password });
  if(error) return { ok:false, message: a51_translateAuthError(error) };
  a51_setSessionCookie();
  return { ok:true, user: data.user };
}

async function a51_signOut(){
  await A51_CLIENT.auth.signOut();
  a51_clearSessionCookie();
}

async function a51_getSession(){
  const { data, error } = await A51_CLIENT.auth.getSession();
  if(error){ console.error(error); return null; }
  return data.session || null;
}

// Guardia de pantalla: llamar al principio de dashboard.html/editor.html.
// Si no hay sesión válida de Supabase, redirige al login. La cookie del
// middleware (a51_admin_session) puede quedar "viva" un rato más de lo
// que dura la sesión real; este chequeo la corrige apenas se detecta.
async function a51_requireSession(){
  const session = await a51_getSession();
  if(!session){
    a51_clearSessionCookie();
    window.location.href = 'index.html';
    return null;
  }
  const admin = await a51_getCurrentAdmin();
  if(!admin){
    await a51_signOut();
    alert('Tu cuenta no tiene permisos de administrador.');
    window.location.href = 'index.html';
    return null;
  }
  a51_setSessionCookie();
  return session;
}

async function a51_getCurrentAdmin(){
  const session = await a51_getSession();
  if(!session) return null;
  const { data, error } = await A51_CLIENT
    .from('admin_users')
    .select('email, role')
    .eq('id', session.user.id)
    .maybeSingle();
  if(error){ console.error(error); return null; }
  return data;
}

/* ---------------------------------------------------------
   Categorías y tags
   --------------------------------------------------------- */

async function a51_getCategories(){
  const { data, error } = await A51_CLIENT.from('categories').select('id, name').order('name');
  if(error){ console.error(error); return []; }
  return data;
}

async function a51_getOrCreateCategoryId(name){
  const clean = (name || '').trim();
  if(!clean) return null;
  const { data: existing, error: selError } = await A51_CLIENT
    .from('categories').select('id').eq('name', clean).maybeSingle();
  if(selError){ console.error(selError); return null; }
  if(existing) return existing.id;
  const { data: created, error: insError } = await A51_CLIENT
    .from('categories').insert({ name: clean }).select('id').single();
  if(insError){ console.error(insError); return null; }
  return created.id;
}

async function a51_getOrCreateTagIds(namesCsv){
  const names = [...new Set(
    (namesCsv || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .map(name => name.slice(0, 80))
  )];
  const ids = [];
  for(const name of names){
    const { data: existing, error: selError } = await A51_CLIENT
      .from('tags').select('id').eq('name', name).maybeSingle();
    if(selError){ console.error(selError); continue; }
    if(existing){ ids.push(existing.id); continue; }
    const { data: created, error: insError } = await A51_CLIENT
      .from('tags').insert({ name }).select('id').single();
    if(insError){ console.error(insError); continue; }
    ids.push(created.id);
  }
  return ids;
}

/* ---------------------------------------------------------
   Productos
   --------------------------------------------------------- */

const A51_PRODUCT_SELECT = `
  id, slug, name, description, req_min, req_rec, size, version, languages, trailer_url,
  install, notes, changelog, dlc, legal_basis, status,
  cover_path, cover_name,
  file_main_path, file_main_name,
  file_notes_path, file_notes_name,
  file_other_path, file_other_name,
  created_at, updated_at,
  categories ( id, name ),
  product_tags ( tags ( name ) ),
  product_downloads ( id, type, url, status, position, health_status, checked_at )
`;

function a51_publicCoverUrl(path){
  if(!path) return null;
  const { data } = A51_CLIENT.storage.from('covers').getPublicUrl(path);
  return data.publicUrl;
}

function a51_mapProductRow(row){
  if(!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || '',
    reqMin: row.req_min || '',
    reqRec: row.req_rec || '',
    size: row.size || '',
    version: row.version || '',
    languages: row.languages || '',
    trailerUrl: row.trailer_url || '',
    install: row.install || '',
    notes: row.notes || '',
    changelog: row.changelog || '',
    dlc: row.dlc || '',
    legalBasis: row.legal_basis,
    status: row.status,
    category: row.categories ? row.categories.name : '',
    tags: (row.product_tags || []).map(pt => pt.tags && pt.tags.name).filter(Boolean).join(', '),
    downloads: (row.product_downloads || [])
      .map(item => ({
        id: item.id,
        type: item.type || 'Otro',
        url: item.url || '',
        status: item.status || 'active',
        position: Number(item.position || 0),
        healthStatus: item.health_status || 'unchecked',
        checkedAt: item.checked_at || null
      }))
      .sort((a,b) => a.position - b.position),
    cover: row.cover_path ? { path: row.cover_path, name: row.cover_name, url: a51_publicCoverUrl(row.cover_path) } : null,
    files: {
      main:  row.file_main_path  ? { path: row.file_main_path,  name: row.file_main_name }  : null,
      notes: row.file_notes_path ? { path: row.file_notes_path, name: row.file_notes_name } : null,
      other: row.file_other_path ? { path: row.file_other_path, name: row.file_other_name } : null,
    },
    updated: row.updated_at ? row.updated_at.slice(0, 10) : '',
  };
}

async function a51_getProducts(){
  const { data, error } = await A51_CLIENT
    .from('products')
    .select(A51_PRODUCT_SELECT)
    .order('updated_at', { ascending:false });
  if(error){ console.error(error); return []; }
  return data.map(a51_mapProductRow);
}

async function a51_getProductBySlug(slug){
  const { data, error } = await A51_CLIENT
    .from('products')
    .select(A51_PRODUCT_SELECT)
    .eq('slug', slug)
    .maybeSingle();
  if(error){ console.error(error); return null; }
  return a51_mapProductRow(data);
}

async function a51_getProductById(id){
  const { data, error } = await A51_CLIENT
    .from('products')
    .select(A51_PRODUCT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if(error){ console.error(error); return null; }
  return a51_mapProductRow(data);
}

function a51_safeFileName(name){
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

async function a51_uploadFile(bucket, productId, file){
  const path = `${productId}/${Date.now()}-${a51_safeFileName(file.name)}`;
  const { error } = await A51_CLIENT.storage.from(bucket).upload(path, file, { upsert:false });
  if(error) return { ok:false, error, stage:'producto' };
  return { ok:true, path, name:file.name };
}

async function a51_removeFile(bucket, path){
  if(!path) return;
  const { error } = await A51_CLIENT.storage.from(bucket).remove([path]);
  if(error) console.error(error);
}

// Sube los archivos nuevos que haya en "input" (coverFile/mainFile/notesFile/
// otherFile), actualiza sus columnas en products, y borra el archivo
// reemplazado para no dejar huérfanos. Los slots sin archivo nuevo quedan
// intactos (no se tocan ni se pisan con null).
async function a51_syncProductFiles(productId, input){
  const patch = {};
  const uploaded = [];
  const oldFiles = [];
  const slots = [
    { file:'coverFile', prev:'prevCover', bucket:'covers', pathCol:'cover_path', nameCol:'cover_name' },
    { file:'mainFile', prev:'prevMain', bucket:'product-files', pathCol:'file_main_path', nameCol:'file_main_name' },
    { file:'otherFile', prev:'prevOther', bucket:'product-files', pathCol:'file_other_path', nameCol:'file_other_name' },
  ];

  for(const slot of slots){
    const file = input[slot.file];
    if(!file) continue;
    if(slot.bucket === 'covers'){
      const allowed = ['image/jpeg','image/png','image/webp'];
      if(!allowed.includes(file.type)) return { ok:false, error:new Error('La portada debe ser JPG, PNG o WEBP.') };
      if(file.size > 5 * 1024 * 1024) return { ok:false, error:new Error('La portada supera 5 MB.') };
    } else if(file.size > 250 * 1024 * 1024){
      return { ok:false, error:new Error('El archivo supera 250 MB.') };
    }
    const res = await a51_uploadFile(slot.bucket, productId, file);
    if(!res.ok){
      for(const u of uploaded) await a51_removeFile(u.bucket, u.path);
      return { ok:false, error:res.error };
    }
    uploaded.push({ bucket:slot.bucket, path:res.path });
    patch[slot.pathCol] = res.path;
    patch[slot.nameCol] = res.name;
    const prev = input[slot.prev];
    if(prev?.path && prev.path !== res.path) oldFiles.push({ bucket:slot.bucket, path:prev.path });
  }

  if(Object.keys(patch).length){
    const { error } = await A51_CLIENT.from('products').update(patch).eq('id', productId);
    if(error){
      for(const u of uploaded) await a51_removeFile(u.bucket, u.path);
      return { ok:false, error };
    }
  }
  for(const old of oldFiles) await a51_removeFile(old.bucket, old.path);
  return { ok:true };
}

// input: campos planos del formulario (name, slug, description, ...,
// category, tags, legalBasis, status) + coverFile/mainFile/notesFile/
// otherFile (File o null) + prevCover/prevMain/prevNotes/prevOther
// ({path,name} o null, para poder limpiar el archivo reemplazado).
function a51_isValidDownloadUrl(value){
  const url = String(value || '').trim();
  if(!url) return false;
  if(url.startsWith('magnet:?')) return true;
  try{
    const parsed = new URL(url);
    return ['http:','https:'].includes(parsed.protocol);
  }catch{
    return false;
  }
}

async function a51_syncProductDownloads(productId, downloads){
  const clean = (downloads || [])
    .map((item,index) => ({
      product_id: productId,
      type: String(item.type || 'Otro').trim().slice(0,50),
      url: String(item.url || '').trim(),
      status: ['active','review','disabled'].includes(item.status) ? item.status : 'active',
      position: Number.isInteger(item.position) ? item.position : index
    }))
    .filter(item => item.url);

  const invalid = clean.find(item => !a51_isValidDownloadUrl(item.url));
  if(invalid) return { ok:false, error:new Error(`El enlace "${invalid.url}" no es válido.`) };

  const { error:deleteError } = await A51_CLIENT
    .from('product_downloads')
    .delete()
    .eq('product_id', productId);
  if(deleteError) return { ok:false, error:deleteError };

  if(!clean.length) return { ok:true };

  const { error:insertError } = await A51_CLIENT
    .from('product_downloads')
    .insert(clean);
  if(insertError) return { ok:false, error:insertError };
  return { ok:true };
}

async function a51_upsertProduct(input){
  try{
    if(!input.name?.trim()) throw new Error('El nombre es obligatorio.');
    if(!input.slug?.trim()) throw new Error('El slug es obligatorio.');
    const categoryId = await a51_getOrCreateCategoryId(input.category);
    const tagIds = await a51_getOrCreateTagIds(input.tags);
    const row = {
      slug: a51_slugify(input.slug), name: input.name.trim(), description: input.description || null,
      req_min: input.reqMin || null, req_rec: input.reqRec || null, size: input.size || null,
      version: input.version || null, languages: input.languages || null, trailer_url: input.trailerUrl || null, install: input.install || null,
      notes: input.notes || null, changelog: input.changelog || null, dlc: input.dlc || null,
      legal_basis: input.legalBasis, status: input.status, category_id: categoryId,
    };

    let saved, error;
    if(input.id){
      ({ data:saved, error } = await A51_CLIENT.from('products').update(row).eq('id', input.id).select('id, slug').single());
    }else{
      ({ data:saved, error } = await A51_CLIENT.from('products').insert(row).select('id, slug').single());
    }
    if(error) return { ok:false, error };

    const filesResult = await a51_syncProductFiles(saved.id, input);
    if(!filesResult.ok) return { ...filesResult, stage:'archivos' };

    const downloadsResult = await a51_syncProductDownloads(saved.id, input.downloads || []);
    if(!downloadsResult.ok) return { ...downloadsResult, stage:'descargas' };

    const { error:delTagError } = await A51_CLIENT.from('product_tags').delete().eq('product_id', saved.id);
    if(delTagError) return { ok:false, error:delTagError, stage:'limpieza de etiquetas' };
    const uniqueTagIds = [...new Set(tagIds)];
    if(uniqueTagIds.length){
      const { error:tagError } = await A51_CLIENT
        .from('product_tags')
        .upsert(
          uniqueTagIds.map(tagId => ({ product_id:saved.id, tag_id:tagId })),
          { onConflict:'product_id,tag_id', ignoreDuplicates:true }
        );
      if(tagError) return { ok:false, error:tagError, stage:'etiquetas' };
    }
    return { ok:true, id:saved.id, slug:saved.slug };
  }catch(error){ return { ok:false, error }; }
}

async function a51_deleteProduct(slug){
  const product = await a51_getProductBySlug(slug);
  if(!product) return { ok:false, error:new Error('Producto no encontrado') };
  const { error } = await A51_CLIENT.from('products').delete().eq('id', product.id);
  if(error) return { ok:false, error };
  await Promise.all([
    product.cover ? a51_removeFile('covers', product.cover.path) : null,
    product.files.main ? a51_removeFile('product-files', product.files.main.path) : null,
    product.files.notes ? a51_removeFile('product-files', product.files.notes.path) : null,
    product.files.other ? a51_removeFile('product-files', product.files.other.path) : null,
  ]);
  return { ok:true };
}

// URL temporal (por defecto 5 minutos) para descargar un archivo privado
// de "product-files". Se genera de nuevo cada vez que se abre la ficha
// pública; la política de Storage solo la entrega si el producto está
// publicado (o si quien pregunta es un admin autenticado).
async function a51_getSignedDownloadUrl(path, expiresInSeconds){
  if(!path) return null;
  const { data, error } = await A51_CLIENT.storage
    .from('product-files')
    .createSignedUrl(path, expiresInSeconds || 300);
  if(error){ console.error(error); return null; }
  return data.signedUrl;
}
