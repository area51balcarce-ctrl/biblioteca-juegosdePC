// AREA51 PC: read-only customer purchase listing.
// Not connected until the feature is approved and tested.
import { readCustomerSession } from './a51-customer-session-store.js';
export async function getCustomerLibrary(req) {
  const session = await readCustomerSession(req);
  if (!session) return null;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Database not configured');
  const url = new URL(base + '/rest/v1/customer_entitlements');
  url.searchParams.set('select', 'product_id,order_id,granted_at');
  url.searchParams.set('customer_email', 'eq.' + session.email);
  url.searchParams.set('revoked_at', 'is.null');
  url.searchParams.set('limit', '500');
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Library query failed');
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}
// These records are NOT sufficient to authorize downloads:
// paid order, matching order item and verified payment must also be checked.
