// AREA 51 — Entrega real aislada, desactivada hasta habilitacion explicita.
import { readCustomerSession } from './a51-customer-session-store.js';
import { magnetFromTorrent } from './torrent-magnet.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function headers(key) { return { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }; }
async function rows(base, table, params, key) {
 const url = new URL(base + '/rest/v1/' + table);
 for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
 const r = await fetch(url,{headers:headers(key),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error('Supabase '+table+' HTTP '+r.status);
 const data=await r.json();
 if(!Array.isArray(data))throw new Error('Respuesta inesperada');
 return data;
}
export default async function liveLinks(req,res) {
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Allow','GET');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido.'});
 if(process.env.AREA51_LIVE_CHECKOUT_ENABLED!=='true'||process.env.AREA51_PUBLIC_CUSTOMER_REGISTRATION!=='true')
  return res.status(503).json({ok:false,error:'Entregas reales todavía deshabilitadas.'});
 let session;
 try {session=await readCustomerSession(req);}catch(error){return res.status(502).json({ok:false,error:'No se pudo validar la sesión.'});}
 if(!session?.email)return res.status(401).json({ok:false,error:'Iniciá sesión.'});
    const productId = typeof req.query?.product_id === 'string' ? req.query.product_id : '';
    if (!UUID.test(productId)) return res.status(400).json({ ok: false, error: 'Producto inválido.' });
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN_PROD?.trim();
    if (!base || !key || !mpToken) return res.status(503).json({ ok: false, error: 'Servicio no configurado.' });
    try {
      const entitlements = await rows(base, 'customer_entitlements', {
        select: 'order_id', customer_email: 'eq.' + session.email,
        product_id: 'eq.' + productId, revoked_at: 'is.null', limit: '2'
      }, key);
      if (entitlements.length !== 1 || !UUID.test(entitlements[0].order_id || '')) {
        return res.status(403).json({ ok: false, error: 'No tenés acceso a este producto.' });
      }
      const orders = await rows(base, 'orders', {
        select: 'id,payment_reference,payment_provider,total_ars,currency',
        id: 'eq.' + entitlements[0].order_id, customer_email: 'eq.' + session.email,
        status: 'eq.paid', limit: '1'
      }, key);
      const order = orders[0];
      if (!order || order.payment_provider !== 'mercadopago' ||
          !/^[0-9]{1,24}$/.test(order.payment_reference || '')) {
        return res.status(403).json({ ok: false, error: 'Compra no acreditada.' });
      }
      // El producto solicitado también debe figurar en los ítems de ESE pedido.
      // Un acceso aislado nunca debe permitir descargar otro juego.
      const purchasedItems = await rows(base, 'order_items', {
        select: 'product_id', order_id: 'eq.' + order.id,
        product_id: 'eq.' + productId, limit: '1'
      }, key);
      if (purchasedItems.length !== 1) {
        return res.status(403).json({ ok: false, error: 'Producto no incluido en el pedido acreditado.' });
      }
      const response = await fetch('https://api.mercadopago.com/v1/payments/' + order.payment_reference, {
        headers: { Authorization: 'Bearer ' + mpToken, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Mercado Pago HTTP ' + response.status);
      const payment = await response.json();
      const sellerResponse = await fetch('https://api.mercadopago.com/users/me', {
        headers: { Authorization: 'Bearer ' + mpToken, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!sellerResponse.ok) throw new Error('Identidad de vendedor HTTP ' + sellerResponse.status);
      const seller = await sellerResponse.json();
      const sellerId = String(process.env.AREA51_MP_PROD_SELLER_ID || '');
      const sellerMatches = /^\d+$/.test(sellerId) && sellerId !== '3544226015' &&
        String(seller?.id ?? '') === sellerId && String(payment?.collector_id ?? '') === sellerId &&
        !(Array.isArray(seller?.tags) && seller.tags.some(t => /test/i.test(String(t))));
      // Validar identidad real y metadata de producción, nunca live_mode solamente.
      const meta = payment?.metadata || {};
      const valid = sellerMatches && payment?.status === 'approved' &&
        payment?.status_detail === 'accredited' &&
        meta.area51_live === true && String(meta.order_id ?? '') === order.id &&
        String(payment?.id ?? '') === order.payment_reference &&
        payment?.external_reference === order.id && payment?.currency_id === order.currency &&
        order.currency === 'ARS' && Number.isSafeInteger(payment?.transaction_amount) &&
        payment.transaction_amount === order.total_ars;
      if (!valid) return res.status(403).json({
        ok: false, downloadsEnabled: false, error: 'El pago todavía no supera la verificación de entrega.'
      });
      const links = await rows(base, 'product_downloads', {
        select: 'id,type,url,group_name,label,position',
        product_id: 'eq.' + productId, status: 'eq.active', order: 'position.asc', limit: '100'
      }, key);
      // No permitir esquemas javascript:, data:, file: u otros destinos inseguros.
      const safeLinks = links.filter(link => {
        try { const u = new URL(link.url); return u.protocol === 'https:' || u.protocol === 'magnet:'; }
        catch (_) { return false; }
      });
      // Archivo principal opcional en bucket PRIVADO, nunca enlace publico.
      // Solo se firma despues de verificar sesion, derecho, pedido y pago REAL.
      const productFiles = await rows(base, 'products', {
        select: 'id,file_main_path,file_main_name',
        id: 'eq.' + productId, limit: '1'
      }, key);
      const file = productFiles[0];
      let torrent = null;
      if (file && typeof file.file_main_path === 'string' &&
          typeof file.file_main_name === 'string' &&
          file.file_main_name.toLowerCase().endsWith('.torrent') &&
          file.file_main_path.startsWith(productId + '/') &&
          !file.file_main_path.split('/').some(part => part === '..' || !part)) {
        const signed = await fetch(base + '/storage/v1/object/sign/product-files/' +
          file.file_main_path.split('/').map(encodeURIComponent).join('/'), {
          method: 'POST',
          headers: { ...headers(key), 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 120 }),
          signal: AbortSignal.timeout(10000)
        });
        if (signed.ok) {
          const data = await signed.json();
          if (typeof data.signedURL === 'string' && data.signedURL.startsWith('/object/sign/')) {
            torrent = { name: file.file_main_name,
              url: base + '/storage/v1' + data.signedURL, expiresIn: 120 };
            // Magnet opcional: extraer infohash del .torrent privado.
            // La descarga tradicional sigue disponible si falla esta lectura.
            try {
              const privateUrl = base + '/storage/v1/object/product-files/' +
                file.file_main_path.split('/').map(encodeURIComponent).join('/');
              const raw = await fetch(privateUrl, {
                headers: { Authorization: 'Bearer ' + key, apikey: key },
                signal: AbortSignal.timeout(10000)
              });
              const size = Number(raw.headers.get('content-length') || 0);
              if (!raw.ok || size > 4 * 1024 * 1024) throw new Error('Torrent no legible');
              const bytes = await raw.arrayBuffer();
              torrent.magnet = magnetFromTorrent(bytes, file.file_main_name);
            } catch (magnetError) {
              console.warn('AREA51 magnet no disponible:', magnetError.message);
            }
          }
        }
      }
      return res.status(200).json({ ok: true, downloadsEnabled: true,
        product_id: productId, links: safeLinks, torrent });
    } catch (error) {
      console.error('AREA51 customer-live-links:', error.message);
      return res.status(502).json({ ok: false, error: 'No se pudo validar la entrega.' });
    }
  }
