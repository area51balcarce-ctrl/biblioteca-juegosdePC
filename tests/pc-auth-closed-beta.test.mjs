// AREA51 PC: tests of closed beta restrictions without real emails, API keys or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/pc/customer-auth-handler.js';

function response() {
  return {
    code: 200, headers: {}, body: null,
    setHeader(name,value){this.headers[name.toLowerCase()]=value;return this},
    status(code){this.code=code;return this},
    json(body){this.body=body;return this}
  };
}
function request(action,email,origin='https://biblioteca-juegosde-pc.vercel.app') {
  return { method:'POST',query:{action},headers:{
    origin,host:'biblioteca-juegosde-pc.vercel.app',
    'x-forwarded-host':'biblioteca-juegosde-pc.vercel.app'
  },body:{email,code:'123456'} };
}
test('feature flag disabled blocks even the authorized email',async()=>{
  const old=process.env.AREA51_CUSTOMER_AUTH_ENABLED;
  delete process.env.AREA51_CUSTOMER_AUTH_ENABLED;
  try {
    const res=response();
    await handler(request('request','area51.balcarce@gmail.com'),res);
    assert.equal(res.code,503);
    assert.equal(res.body.ok,false);
  } finally {
    if(old===undefined) delete process.env.AREA51_CUSTOMER_AUTH_ENABLED;
    else process.env.AREA51_CUSTOMER_AUTH_ENABLED=old;
  }
});
test('closed beta rejects other email addresses before any email is sent',async()=>{
  const old=process.env.AREA51_CUSTOMER_AUTH_ENABLED;
  process.env.AREA51_CUSTOMER_AUTH_ENABLED='true';
  try {
    for(const action of ['request','verify']){
      const res=response();
      await handler(request(action,'other-customer@example.com'),res);
      assert.equal(res.code,403);
      assert.equal(res.body.ok,false);
    }
  } finally {
    if(old===undefined) delete process.env.AREA51_CUSTOMER_AUTH_ENABLED;
    else process.env.AREA51_CUSTOMER_AUTH_ENABLED=old;
  }
});
test('closed beta rejects requests from foreign origins',async()=>{
  const old=process.env.AREA51_CUSTOMER_AUTH_ENABLED;
  process.env.AREA51_CUSTOMER_AUTH_ENABLED='true';
  try {
    const res=response();
    await handler(request('request','area51.balcarce@gmail.com','https://example.org'),res);
    assert.equal(res.code,403);
  } finally {
    if(old===undefined) delete process.env.AREA51_CUSTOMER_AUTH_ENABLED;
    else process.env.AREA51_CUSTOMER_AUTH_ENABLED=old;
  }
});
