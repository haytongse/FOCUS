/**
 * Test: verify signature image is linked to SO-26-0019
 * Usage: EMAIL=you@email.com PASSWORD=yourpass node test-signature.mjs
 */

const BASE_URL  = 'https://focuslaberp.focuslab.in';
const EMAIL     = process.env.EMAIL    || '';
const PASSWORD  = process.env.PASSWORD || '';
const TARGET_REF = 'SO-26-0019';

if (!EMAIL || !PASSWORD) {
  console.error('Usage: EMAIL=you@email.com PASSWORD=yourpass node test-signature.mjs');
  process.exit(1);
}

const log  = (label, data) => console.log(`\n✅ ${label}\n`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const fail = (label, data) => { console.error(`\n❌ ${label}\n`, JSON.stringify(data, null, 2)); };

async function req(method, path, body, token) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${path}`), { status: res.status, data });
  return data;
}

async function run() {
  // ── 1. Login ────────────────────────────────────────────────────────────────
  console.log('\n━━━ STEP 1: LOGIN ━━━━━━━━━━━━━━━━━━━━━━━━━');
  const loginRes = await req('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
  const token    = loginRes?.data?.accessToken ?? loginRes?.data?.token ?? loginRes?.token;
  if (!token) { fail('No token', loginRes); process.exit(1); }
  log('Logged in', token.slice(0, 40) + '...');

  // ── 2. Fetch all sale orders → find SO-26-0019 ──────────────────────────────
  console.log(`\n━━━ STEP 2: FIND ${TARGET_REF} ━━━━━━━━━━━━━━━━━━━`);
  const soListRes = await req('GET', '/api/v1/sales-orders', null, token);
  const soItems   = soListRes?.data?.items ?? soListRes?.data ?? soListRes ?? [];
  const so        = soItems.find(o =>
    (o.ref ?? o.referenceNumber ?? o.orderNumber ?? '') === TARGET_REF
  );
  if (!so) {
    fail(`${TARGET_REF} not found in ${soItems.length} orders`, soItems.map(o => o.ref ?? o.referenceNumber ?? o.id));
    process.exit(1);
  }
  log(`Found ${TARGET_REF}`, { id: so.id, ref: so.ref, status: so.status });

  // ── 3. Fetch delivery orders → find one linked to this SO ───────────────────
  console.log('\n━━━ STEP 3: DELIVERY ORDERS ━━━━━━━━━━━━━━━━');
  const doListRes = await req('GET', '/api/v1/delivery-orders', null, token);
  const doItems   = doListRes?.data?.items ?? doListRes?.data ?? doListRes ?? [];
  log(`Total delivery orders`, doItems.length);

  const linked = doItems.filter(d => {
    const sid = d.soId ?? d.so_id ?? d.salesOrderId ?? d.sales_order_id ??
                d.orderId ?? d.order_id ?? d.salesOrder?.id ?? d.sale_order?.id;
    return sid === so.id;
  });

  if (linked.length === 0) {
    fail(`No delivery order linked to SO id="${so.id}"`, {
      hint: 'Check that d.soId matches so.id',
      sampleDoKeys: doItems[0] ? Object.keys(doItems[0]) : [],
    });
  } else {
    log(`Delivery orders linked to ${TARGET_REF}`, linked.map(d => ({
      doId:         d.doId ?? d.do_id ?? d.id,
      soId:         d.soId ?? d.so_id,
      signatureUrl: d.signatureUrl ?? d.signature_url ?? d.signatureImageUrl ?? d.signature_image_url ?? null,
      rawKeys:      Object.keys(d),
    })));
  }

  // ── 4. Check the signature URL resolves ─────────────────────────────────────
  console.log('\n━━━ STEP 4: CHECK SIGNATURE IMAGE URL ━━━━━━━');
  for (const d of linked) {
    const sigUrl = d.signatureUrl ?? d.signature_url ?? d.signatureImageUrl ?? d.signature_image_url ?? null;
    if (!sigUrl) {
      fail('signatureUrl is null/missing on delivery order', d);
      continue;
    }
    log('signatureUrl found', sigUrl);
    try {
      const imgRes = await fetch(sigUrl);
      log(`Image HTTP ${imgRes.status}`, `Content-Type: ${imgRes.headers.get('content-type')}`);
      if (!imgRes.ok) fail('Image URL returned non-200', sigUrl);
    } catch (e) {
      fail('Could not fetch image URL', e.message);
    }
  }

  // ── 5. Summary ───────────────────────────────────────────────────────────────
  console.log('\n━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  SO ref      : ${so.ref ?? so.referenceNumber}`);
  console.log(`  SO id       : ${so.id}`);
  console.log(`  SO status   : ${so.status}`);
  console.log(`  Delivery DOs: ${linked.length}`);
  linked.forEach((d, i) => {
    const sig = d.signatureUrl ?? d.signature_url ?? d.signatureImageUrl ?? d.signature_image_url ?? null;
    console.log(`  DO[${i}] sigUrl : ${sig ?? '⚠️  MISSING'}`);
  });
  console.log('');
}

run().catch(err => {
  console.error('\n💥 TEST FAILED:', err?.message);
  if (err?.data) console.error('  API response:', JSON.stringify(err.data, null, 2));
  process.exit(1);
});
