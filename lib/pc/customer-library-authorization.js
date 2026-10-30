// AREA51 PC - pure authorization rules for future customer library.
// This module cannot query the database or grant download links.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_ID=/^[0-9]{1,24}$/;
export function authorizedLibraryRows(email, entitlements, orders, items) {
  if(typeof email!=='string'||email!==email.trim().toLowerCase()||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
    !Array.isArray(entitlements)||!Array.isArray(orders)||!Array.isArray(items)) return [];
  const paid=new Set(orders.filter(o=>o?.customer_email===email &&
    o.status==='paid' && o.payment_provider==='mercadopago' &&
    PAYMENT_ID.test(String(o.payment_reference||'')) && UUID.test(o.id||''))
    .map(o=>o.id));
  const purchased=new Map(items.filter(i=>paid.has(i?.order_id) &&
    UUID.test(i.product_id||'') && Number.isInteger(i.quantity) && i.quantity>0 &&
    typeof i.product_name==='string' && i.product_name.trim())
    .map(i=>[i.order_id+':'+i.product_id,i.product_name.trim()]));
  const unique=new Map();
  for(const e of entitlements) {
    if(e?.customer_email!==email || e.revoked_at || !paid.has(e.order_id) ||
      !UUID.test(e.product_id||'')) continue;
    const name=purchased.get(e.order_id+':'+e.product_id);
    if(!name || unique.has(e.product_id)) continue;
    unique.set(e.product_id,{product_id:e.product_id,name,granted_at:e.granted_at});
  }
  return [...unique.values()];
}
