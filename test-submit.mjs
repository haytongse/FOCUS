/**
 * Full submit-order flow test
 * Usage: EMAIL=you@email.com PASSWORD=yourpass node test-submit.mjs
 */

const BASE_URL = 'https://focuslaberp.focuslab.in';
const EMAIL    = process.env.EMAIL    || '';
const PASSWORD = process.env.PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  console.error('Usage: EMAIL=you@email.com PASSWORD=yourpass node test-submit.mjs');
  process.exit(1);
}

const log  = (label, data) => console.log(`\n✅ ${label}\n`, JSON.stringify(data, null, 2));
const warn = (label, data) => console.warn(`\n❌ ${label}\n`, JSON.stringify(data, null, 2));

async function req(method, path, body, token) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  console.log(`\n──── ${method} ${path} ────`);
  if (body) console.log('  Body:', JSON.stringify(body, null, 2));

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  console.log(`  Status: ${res.status}`);
  console.log('  Response:', JSON.stringify(data, null, 2));

  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, data });
  return data;
}

async function run() {
  // ── Step 1: Login ───────────────────────────────────────────────────────────
  console.log('\n━━━ STEP 1: LOGIN ━━━━━━━━━━━━━━━━━━━━━━━━━');
  const loginRes = await req('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
  const token = loginRes?.data?.accessToken ?? loginRes?.data?.token ?? loginRes?.token;
  if (!token) { warn('No token in response', loginRes); process.exit(1); }
  log('Token received', token.slice(0, 40) + '...');

  // ── Step 2: Get Campuses ────────────────────────────────────────────────────
  console.log('\n━━━ STEP 2: GET CAMPUSES ━━━━━━━━━━━━━━━━━━━');
  const campusRes = await req('GET', '/api/v1/campuses', null, token);
  const campuses  = campusRes?.data?.items ?? campusRes?.data ?? campusRes ?? [];
  log('Campuses', campuses);

  const campus = Array.isArray(campuses) && campuses.length > 0 ? campuses[0] : null;
  if (!campus) { warn('No campuses found', campusRes); process.exit(1); }
  log('Using campus', campus);

  // ── Step 3: Get Products ────────────────────────────────────────────────────
  console.log('\n━━━ STEP 3: GET PRODUCTS ━━━━━━━━━━━━━━━━━━━');
  const prodRes  = await req('GET', '/api/v1/products', null, token);
  const products = prodRes?.data?.items ?? prodRes?.data ?? prodRes ?? [];
  const product  = Array.isArray(products) && products.length > 0 ? products[0] : null;
  if (!product) { warn('No products found', prodRes); process.exit(1); }
  log('Using product', product);

  // ── Step 4: Create Sales Order ──────────────────────────────────────────────
  console.log('\n━━━ STEP 4: CREATE SALES ORDER ━━━━━━━━━━━━━');
  const campusId     = campus.id;
  const customerOrgId = campus.orgId ?? campus.org_id;
  log('campusId', campusId);
  log('customerOrgId', customerOrgId);

  const soPayload = {
    campusId,
    customerOrgId,
    rateUsed: 4100,
    items: [{
      productId:      product.id,
      qty:            1,
      unitPriceCents: product.fixedPriceCents ? parseInt(product.fixedPriceCents) : 1000,
      discountCents:  0,
    }],
  };
  const soRes = await req('POST', '/api/v1/sales-orders', soPayload, token);
  const so    = soRes?.data ?? soRes;
  const soId  = so?.id;
  if (!soId) { warn('No SO id in response', soRes); process.exit(1); }
  log('Sales Order created — soId', soId);

  // ── Step 5: Get SO Detail ───────────────────────────────────────────────────
  console.log('\n━━━ STEP 5: GET SO DETAIL ━━━━━━━━━━━━━━━━━━');
  const detailRes = await req('GET', `/api/v1/sales-orders/${soId}`, null, token);
  const soDetail  = detailRes?.data ?? detailRes;
  const soItems   = soDetail?.items ?? [];
  log('SO detail items', soItems);

  if (soItems.length === 0) {
    warn('SO detail has no items — delivery order may fail', soDetail);
  }

  // ── Step 6: Create Delivery Order ───────────────────────────────────────────
  console.log('\n━━━ STEP 6: CREATE DELIVERY ORDER ━━━━━━━━━━');
  const doPayload = {
    items: soItems.map(i => ({ soItemId: i.id, qtyDelivered: i.qty })),
    campusId,
    receivedBy:  'Test User',
    deliveredAt: new Date().toISOString(),
  };
  const doRes = await req('POST', `/api/v1/sales-orders/${soId}/delivery-orders`, doPayload, token);
  log('Delivery Order created', doRes);

  console.log('\n\n🎉 ALL STEPS PASSED — Submit order flow works!\n');
}

run().catch(err => {
  console.error('\n\n💥 TEST FAILED');
  console.error('  Message :', err?.message);
  console.error('  Status  :', err?.status);
  console.error('  Response:', JSON.stringify(err?.data, null, 2));
  process.exit(1);
});
