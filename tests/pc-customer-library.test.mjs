import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedLibraryRows } from '../lib/pc/customer-library-authorization.js';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const email='area51.balcarce@gmail.com';
const other='otro@example.com';
function fixtures(){
  return {
    e:[{customer_email:email,order_id:A,product_id:B,revoked_at:null,granted_at:'2026-10-29T12:00:00Z'}],
    o:[{id:A,customer_email:email,status:'paid',payment_provider:'mercadopago',payment_reference:'12345'}],
    i:[{order_id:A,product_id:B,product_name:'Juego de prueba',quantity:1}]
  };
}
test('library shows only an authorized paid purchase',()=>{
  const {e,o,i}=fixtures();
  assert.deepEqual(authorizedLibraryRows(email,e,o,i),[{product_id:B,name:'Juego de prueba',granted_at:'2026-10-29T12:00:00Z'}]);
});
test('different customer, unpaid order, refund and revocation never grant access',()=>{
  const {e,o,i}=fixtures();
  assert.deepEqual(authorizedLibraryRows(other,e,o,i),[]);
  for(const status of ['pending','refunded','cancelled','expired']){
    assert.deepEqual(authorizedLibraryRows(email,e,[{...o[0],status}],i),[]);
  }
  assert.deepEqual(authorizedLibraryRows(email,[{...e[0],revoked_at:'2026-10-30T00:00:00Z'}],o,i),[]);
  assert.deepEqual(authorizedLibraryRows(email,e,[{...o[0],customer_email:other}],i),[]);
});
test('missing order item, incorrect payment reference or duplicate entitlement do not leak',()=>{
  const {e,o,i}=fixtures();
  assert.deepEqual(authorizedLibraryRows(email,e,o,[]),[]);
  assert.deepEqual(authorizedLibraryRows(email,e,[{...o[0],payment_reference:'unverified'}],i),[]);
  assert.equal(authorizedLibraryRows(email,[...e,...e],o,i).length,1);
});
