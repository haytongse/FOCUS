/**
 * Probe script — find the correct SO confirm endpoint
 * Usage: node probe-confirm.mjs
 */
const BASE_URL = 'https://focuslaberp.focuslab.in';
const EMAIL    = 'owner@focuslab.local';
const PASSWORD = 'owner1234';

async function req(method, path, body, token) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) {
    data = await res.json().catch(() => null);
  } else {
    const text = await res.text();
    data = text.slice(0, 120);
  }
  return { status: res.status, data };
}

async function run() {
  // Login
  const loginRes = await req('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
  const token = loginRes.data?.data?.accessToken ?? loginRes.data?.data?.token ?? loginRes.data?.token;
  if (!token) { console.error('Login failed', loginRes); process.exit(1); }
  console.log('✅ Logged in\n');

  // Create a throwaway SO to get a real ID
  const campusesRes = await req('GET', '/api/v1/campuses', null, token);
  const campuses = campusesRes.data?.data?.items ?? campusesRes.data?.data ?? [];
  const campus = campuses[0];
  if (!campus) { console.error('No campuses found'); process.exit(1); }

  const productsRes = await req('GET', '/api/v1/products', null, token);
  const products = productsRes.data?.data?.items ?? productsRes.data?.data ?? [];
  const product = products[0];
  if (!product) { console.error('No products found'); process.exit(1); }

  const soRes = await req('POST', '/api/v1/sales-orders', {
    campusId: campus.id,
    customerOrgId: campus.orgId ?? '1',
    rateUsed: 4100,
    items: [{ productId: product.id, qty: 1, unitPriceCents: product.fixedPriceCents ? parseInt(product.fixedPriceCents) : 100, discountCents: 0 }],
  }, token);
  const soId = soRes.data?.data?.id ?? soRes.data?.id;
  if (!soId) { console.error('Could not create test SO', soRes); process.exit(1); }
  console.log(`✅ Created test SO: ${soId}  status=${soRes.data?.data?.status ?? soRes.data?.status}\n`);

  // Probe candidate confirm endpoints
  const candidates = [
    ['POST',  `/api/v1/sales-orders/${soId}/confirm`,  null],
    ['PUT',   `/api/v1/sales-orders/${soId}/confirm`,  null],
    ['PATCH', `/api/v1/sales-orders/${soId}/confirm`,  null],
    ['POST',  `/api/v1/sales-orders/${soId}/approve`,  null],
    ['PATCH', `/api/v1/sales-orders/${soId}/status`,   { status: 'CONFIRMED' }],
    ['PUT',   `/api/v1/sales-orders/${soId}/status`,   { status: 'CONFIRMED' }],
    ['PATCH', `/api/v1/sales-orders/${soId}`,          { status: 'CONFIRMED' }],
    ['PUT',   `/api/v1/sales-orders/${soId}`,          { status: 'CONFIRMED' }],
    ['POST',  `/api/v1/sales-orders/${soId}/process`,  null],
    ['PATCH', `/api/v1/sales-orders/${soId}/process`,  null],
  ];

  console.log('─── Probing confirm endpoints ───────────────────');
  for (const [method, path, body] of candidates) {
    const r = await req(method, path, body, token);
    const icon = r.status < 400 ? '✅' : r.status === 404 ? '❌ 404' : `⚠️  ${r.status}`;
    const msg  = typeof r.data === 'string' ? r.data : JSON.stringify(r.data)?.slice(0, 120);
    console.log(`${icon}  ${method.padEnd(6)} ${path}\n       → ${msg}\n`);
    // Stop probing once we find a working one
    if (r.status >= 200 && r.status < 300) {
      console.log('\n🎉 Found working endpoint!');
      break;
    }
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
