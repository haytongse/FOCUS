import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Print from 'expo-print';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import Colors from '../../theme/colors';
import {
  getOpenCashierSessionApi,
  getCashierSessionsApi,
  addCashierTransactionApi,
  ApiCashierSession,
  ApiCashierTransaction,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

type Tab = 'cashInOut' | 'history';
type TxType = 'CASH_IN' | 'CASH_OUT';

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const fmtShort = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const DENOMS = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1];
const denomLabel = (c: number) => c >= 100 ? `$${c / 100}` : `¢${c}`;

const buildZReportHTML = (sess: ApiCashierSession): string => {
  const now  = fmtDate(new Date().toISOString());
  const diff = sess.differenceCents ?? 0;
  const diffColor = diff === 0 ? '#059669' : diff > 0 ? '#2563EB' : '#DC2626';
  const diffSign  = diff > 0 ? '+' : '';

  const txRows = Array.isArray(sess.transactions) && sess.transactions.length > 0
    ? sess.transactions.map(tx => `
        <tr>
          <td>${tx.type.replace('_', ' ')}</td>
          <td>${tx.note ?? tx.reference ?? '—'}</td>
          <td>${fmtDate(tx.createdAt)}</td>
          <td style="text-align:right;font-weight:600">${fmt(tx.amountCents)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#9CA3AF">No transaction detail available</td></tr>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#111827;background:#fff;padding:24px}
  h1{font-size:20px;font-weight:800;color:#1E3A5F;margin-bottom:2px}
  .sub{font-size:12px;color:#6B7280;margin-bottom:18px}
  .section{margin-bottom:18px}
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6B7280;margin-bottom:8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px}
  .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F3F4F6}
  .row:last-child{border-bottom:none}
  .lbl{color:#6B7280}
  .val{font-weight:600;color:#111827}
  .total-row{display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:700;border-top:2px solid #1E3A5F;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#F3F4F6;padding:6px 8px;text-align:left;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#6B7280}
  td{padding:6px 8px;border-bottom:1px solid #F3F4F6;color:#374151}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700}
  .open{background:#D1FAE5;color:#059669}.closed{background:#F3F4F6;color:#6B7280}
  .footer{margin-top:24px;text-align:center;font-size:10px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:12px}
</style></head><body>
  <h1>FOCUS POS — Session Report</h1>
  <div class="sub">Printed: ${now}</div>

  <div class="section">
    <div class="section-title">Session Info</div>
    <div class="row"><span class="lbl">Session #</span><span class="val">${sess.sessionNumber}</span></div>
    <div class="row"><span class="lbl">Status</span><span class="val"><span class="badge ${sess.status === 'OPEN' ? 'open' : 'closed'}">${sess.status}</span></span></div>
    <div class="row"><span class="lbl">Opened At</span><span class="val">${fmtDate(sess.openedAt)}</span></div>
    <div class="row"><span class="lbl">Closed At</span><span class="val">${sess.closedAt ? fmtDate(sess.closedAt) : '—'}</span></div>
    ${sess.rateUsed ? `<div class="row"><span class="lbl">Exchange Rate</span><span class="val">${sess.rateUsed} KHR/$</span></div>` : ''}
    ${sess.note ? `<div class="row"><span class="lbl">Note</span><span class="val">${sess.note}</span></div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Cash Summary</div>
    <div class="row"><span class="lbl">Opening Float</span><span class="val">${fmt(sess.openingFloatCents)}</span></div>
    <div class="row"><span class="lbl">Total Sales</span><span class="val">${fmt(sess.totalSalesCents ?? 0)}</span></div>
    <div class="row"><span class="lbl">Cash In</span><span class="val">${fmt(sess.totalCashInCents ?? 0)}</span></div>
    <div class="row"><span class="lbl">Cash Out</span><span class="val">${fmt(sess.totalCashOutCents ?? 0)}</span></div>
    ${sess.expectedCashCents != null ? `<div class="row"><span class="lbl">Expected Cash</span><span class="val">${fmt(sess.expectedCashCents)}</span></div>` : ''}
    ${sess.closingCashCents  != null ? `<div class="row"><span class="lbl">Counted Cash</span><span class="val">${fmt(sess.closingCashCents)}</span></div>` : ''}
    ${sess.differenceCents   != null ? `
    <div class="total-row">
      <span>Difference</span>
      <span style="color:${diffColor}">${diffSign}${fmt(diff)}</span>
    </div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Transactions</div>
    <table>
      <thead><tr><th>Type</th><th>Note / Ref</th><th>Time</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${txRows}</tbody>
    </table>
  </div>

  <div class="footer">FOCUS ERP · Session ${sess.sessionNumber} · Reprinted ${now}</div>
</body></html>`;
};

const CashierManageScreen: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>('cashInOut');

  // ── Cash In/Out state ─────────────────────────────────────
  const [openSession,   setOpenSession]   = useState<ApiCashierSession | null>(null);
  const [sessLoading,   setSessLoading]   = useState(true);
  const [amount,        setAmount]        = useState('');
  const [txType,        setTxType]        = useState<TxType>('CASH_IN');
  const [note,          setNote]          = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [txError,       setTxError]       = useState<string | null>(null);
  const [txSuccess,     setTxSuccess]     = useState<string | null>(null);

  // ── Session history state ──────────────────────────────────
  const [sessions,      setSessions]      = useState<ApiCashierSession[]>([]);
  const [histLoading,   setHistLoading]   = useState(false);
  const [histError,     setHistError]     = useState<string | null>(null);
  const [expandedId,    setExpandedId]    = useState<string | number | null>(null);
  const [printingId,    setPrintingId]    = useState<string | number | null>(null);

  // ── Load open session ──────────────────────────────────────
  const loadOpenSession = useCallback(() => {
    setSessLoading(true);
    getOpenCashierSessionApi()
      .then(s => setOpenSession(s))
      .catch(() => setOpenSession(null))
      .finally(() => setSessLoading(false));
  }, []);

  // ── Load session history ───────────────────────────────────
  const loadHistory = useCallback(() => {
    setHistLoading(true);
    setHistError(null);
    getCashierSessionsApi()
      .then(list => setSessions([...list].sort((a, b) => {
        const ta = a.openedAt ?? a.createdAt ?? '';
        const tb = b.openedAt ?? b.createdAt ?? '';
        return tb.localeCompare(ta);
      })))
      .catch(e => setHistError(e?.message ?? 'Failed to load sessions'))
      .finally(() => setHistLoading(false));
  }, []);

  useEffect(() => { loadOpenSession(); }, [loadOpenSession]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  // ── Print Z-report ────────────────────────────────────────
  const handlePrint = useCallback(async (sess: ApiCashierSession) => {
    setPrintingId(sess.id);
    try {
      await Print.printAsync({ html: buildZReportHTML(sess) });
    } catch (e: any) {
      // user cancelled or print error — silently ignore cancel
      // non-cancel print errors are silently ignored
    } finally {
      setPrintingId(null);
    }
  }, []);

  // ── Record transaction ─────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!openSession) return;
    const cents = Math.round(parseFloat(amount || '0') * 100);
    if (!cents || cents <= 0) { setTxError('Enter a valid amount greater than $0'); return; }
    setSubmitting(true);
    setTxError(null);
    setTxSuccess(null);
    try {
      await addCashierTransactionApi(openSession.id, { type: txType, amountCents: cents, note: note.trim() || undefined });
      setTxSuccess(`${txType === 'CASH_IN' ? 'Cash In' : 'Cash Out'} of ${fmt(cents)} recorded.`);
      setAmount('');
      setNote('');
      loadOpenSession();
    } catch (e: any) {
      setTxError(e?.message ?? 'Failed to record transaction');
    } finally {
      setSubmitting(false);
    }
  }, [openSession, amount, txType, note, loadOpenSession]);

  // ── Helpers ───────────────────────────────────────────────
  const txColor = (type: string) => {
    if (type === 'CASH_IN')  return '#059669';
    if (type === 'CASH_OUT') return '#DC2626';
    if (type === 'SALE')     return '#2563EB';
    return Colors.textSecondary;
  };

  const diffColor = (cents?: number) => {
    if (cents == null) return Colors.textSecondary;
    if (cents === 0) return '#059669';
    if (cents > 0)   return '#2563EB';
    return '#DC2626';
  };

  // ── RENDER ────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <AppBar title="Cashier" subtitle="Cash In/Out & Session History" titleAlign="left" showBack onBack={onBack} />

      {/* Tabs */}
      <View style={s.tabBar}>
        {([['cashInOut', 'Cash In/Out'], ['history', 'Session History']] as [Tab, string][]).map(([t, label]) => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <AppText style={[s.tabTxt, tab === t && s.tabTxtActive]}>{label}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* ─── CASH IN/OUT TAB ─── */}
      {tab === 'cashInOut' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* Open Session card */}
            {sessLoading ? (
              <View style={s.loadBox}><ActivityIndicator color={Colors.primary} /></View>
            ) : openSession ? (
              <View style={s.sessionCard}>
                <View style={s.sessionCardRow}>
                  <View style={[s.statusDot, { backgroundColor: '#4ADE80' }]} />
                  <AppText style={s.sessionNum}>{openSession.sessionNumber}</AppText>
                  <View style={s.openBadge}><AppText style={s.openBadgeTxt}>OPEN</AppText></View>
                </View>
                <View style={s.sessionStats}>
                  {[
                    ['Opening Float', fmt(openSession.openingFloatCents)],
                    ['Total Sales',   fmt(openSession.totalSalesCents ?? 0)],
                    ['Cash In',       fmt(openSession.totalCashInCents ?? 0)],
                    ['Cash Out',      fmt(openSession.totalCashOutCents ?? 0)],
                  ].map(([l, v]) => (
                    <View key={l} style={s.statItem}>
                      <AppText style={s.statLbl}>{l}</AppText>
                      <AppText style={s.statVal}>{v}</AppText>
                    </View>
                  ))}
                </View>
                {openSession.openedAt && (
                  <AppText style={s.sessionDate}>Opened: {fmtDate(openSession.openedAt)}</AppText>
                )}
              </View>
            ) : (
              <View style={s.noSessionCard}>
                <AppText style={s.noSessionIcon}>⊠</AppText>
                <AppText style={s.noSessionTxt}>No open cashier session</AppText>
                <AppText style={s.noSessionHint}>Open a shift from the POS screen to record cash transactions.</AppText>
              </View>
            )}

            {/* Record form */}
            {openSession && (
              <View style={s.card}>
                <AppText style={s.cardTitle}>Record Transaction</AppText>

                {/* Type selector */}
                <View style={s.typeRow}>
                  {(['CASH_IN', 'CASH_OUT'] as TxType[]).map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[s.typeBtn, txType === t && (t === 'CASH_IN' ? s.typeBtnIn : s.typeBtnOut)]}
                      onPress={() => setTxType(t)}
                    >
                      <AppText style={[s.typeBtnTxt, txType === t && s.typeBtnTxtActive]}>
                        {t === 'CASH_IN' ? '↓ Cash In' : '↑ Cash Out'}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Amount */}
                <AppText style={s.fieldLbl}>Amount ($)</AppText>
                <TextInput
                  style={s.input}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={Colors.textSecondary}
                />

                {/* Note */}
                <AppText style={s.fieldLbl}>Note (optional)</AppText>
                <TextInput
                  style={[s.input, s.inputMulti]}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Reason for transaction…"
                  placeholderTextColor={Colors.textSecondary}
                  multiline
                  numberOfLines={3}
                />

                {txError   && <View style={s.errBox}><AppText style={s.errTxt}>{txError}</AppText></View>}
                {txSuccess && <View style={s.successBox}><AppText style={s.successTxt}>✓  {txSuccess}</AppText></View>}

                <TouchableOpacity
                  style={[s.submitBtn, submitting && s.submitBtnDis, txType === 'CASH_OUT' && s.submitBtnOut]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#FFF" />
                    : <AppText style={s.submitBtnTxt}>
                        {txType === 'CASH_IN' ? '↓ Record Cash In' : '↑ Record Cash Out'}
                      </AppText>
                  }
                </TouchableOpacity>
              </View>
            )}

            {/* Recent transactions from open session */}
            {openSession && Array.isArray(openSession.transactions) && openSession.transactions.length > 0 && (
              <View style={s.card}>
                <AppText style={s.cardTitle}>Recent Transactions</AppText>
                {openSession.transactions
                  .filter(tx => tx.type === 'CASH_IN' || tx.type === 'CASH_OUT')
                  .slice(0, 20)
                  .map((tx, i) => (
                    <View key={String(tx.id ?? i)} style={[s.txRow, i > 0 && s.txRowBorder]}>
                      <View style={[s.txTypeBadge, { backgroundColor: tx.type === 'CASH_IN' ? '#D1FAE5' : '#FEE2E2' }]}>
                        <AppText style={[s.txTypeTxt, { color: txColor(tx.type) }]}>
                          {tx.type === 'CASH_IN' ? '↓ IN' : '↑ OUT'}
                        </AppText>
                      </View>
                      <View style={{ flex: 1, paddingHorizontal: 10 }}>
                        <AppText style={s.txNote} numberOfLines={1}>{tx.note || '—'}</AppText>
                        <AppText style={s.txDate}>{fmtDate(tx.createdAt)}</AppText>
                      </View>
                      <AppText style={[s.txAmount, { color: txColor(tx.type) }]}>
                        {tx.type === 'CASH_IN' ? '+' : '−'}{fmt(tx.amountCents)}
                      </AppText>
                    </View>
                  ))
                }
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ─── SESSION HISTORY TAB ─── */}
      {tab === 'history' && (
        histLoading ? (
          <View style={s.loadBox}><ActivityIndicator size="large" color={Colors.primary} /></View>
        ) : histError ? (
          <View style={s.loadBox}>
            <AppText style={{ color: Colors.error, marginBottom: 12 }}>{histError}</AppText>
            <TouchableOpacity style={s.retryBtn} onPress={loadHistory}>
              <AppText style={{ color: '#FFF', fontWeight: '700' }}>Retry</AppText>
            </TouchableOpacity>
          </View>
        ) : sessions.length === 0 ? (
          <View style={s.loadBox}>
            <AppText style={{ color: Colors.textSecondary }}>No sessions found</AppText>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={histLoading} onRefresh={loadHistory} />}
          >
            {sessions.map(sess => {
              const isOpen   = sess.status === 'OPEN';
              const expanded = expandedId === sess.id;
              const diff     = sess.differenceCents;

              return (
                <TouchableOpacity
                  key={String(sess.id)}
                  style={s.sessCard}
                  onPress={() => setExpandedId(expanded ? null : sess.id)}
                  activeOpacity={0.85}
                >
                  {/* Header row */}
                  <View style={s.sessCardHdr}>
                    <View style={s.sessCardLeft}>
                      <View style={[s.statusDot, { backgroundColor: isOpen ? '#4ADE80' : Colors.border }]} />
                      <View>
                        <AppText style={s.sessNum}>{sess.sessionNumber}</AppText>
                        <AppText style={s.sessDate}>{fmtShort(sess.openedAt ?? sess.createdAt)}</AppText>
                      </View>
                    </View>
                    <View style={s.sessCardRight}>
                      <View style={[s.statusBadge, { backgroundColor: isOpen ? '#D1FAE5' : '#F3F4F6' }]}>
                        <AppText style={[s.statusBadgeTxt, { color: isOpen ? '#059669' : Colors.textSecondary }]}>
                          {isOpen ? 'OPEN' : 'CLOSED'}
                        </AppText>
                      </View>
                      {!isOpen && (
                        <TouchableOpacity
                          style={s.printBtn}
                          onPress={e => { e.stopPropagation?.(); handlePrint(sess); }}
                          disabled={printingId === sess.id}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          {printingId === sess.id
                            ? <ActivityIndicator size="small" color={Colors.primary} />
                            : <AppText style={s.printBtnTxt}>⎙ Print</AppText>
                          }
                        </TouchableOpacity>
                      )}
                      <AppText style={s.expandArrow}>{expanded ? '▲' : '▼'}</AppText>
                    </View>
                  </View>

                  {/* Summary row always visible */}
                  <View style={s.sessSummary}>
                    <View style={s.sessStat}>
                      <AppText style={s.sessStatLbl}>Float</AppText>
                      <AppText style={s.sessStatVal}>{fmt(sess.openingFloatCents)}</AppText>
                    </View>
                    <View style={s.sessStat}>
                      <AppText style={s.sessStatLbl}>Sales</AppText>
                      <AppText style={s.sessStatVal}>{fmt(sess.totalSalesCents ?? 0)}</AppText>
                    </View>
                    {!isOpen && sess.closingCashCents != null && (
                      <View style={s.sessStat}>
                        <AppText style={s.sessStatLbl}>Closing</AppText>
                        <AppText style={s.sessStatVal}>{fmt(sess.closingCashCents)}</AppText>
                      </View>
                    )}
                    {!isOpen && diff != null && (
                      <View style={s.sessStat}>
                        <AppText style={s.sessStatLbl}>Diff</AppText>
                        <AppText style={[s.sessStatVal, { color: diffColor(diff), fontWeight: '700' }]}>
                          {diff > 0 ? '+' : ''}{fmt(diff)}
                        </AppText>
                      </View>
                    )}
                  </View>

                  {/* Expanded detail */}
                  {expanded && (
                    <View style={s.sessDetail}>
                      <View style={s.sessDetailDivider} />
                      {[
                        ['Opened At',       fmtDate(sess.openedAt)],
                        ['Closed At',       sess.closedAt ? fmtDate(sess.closedAt) : '—'],
                        ['Opening Float',   fmt(sess.openingFloatCents)],
                        ['Total Sales',     fmt(sess.totalSalesCents ?? 0)],
                        ['Cash In',         fmt(sess.totalCashInCents ?? 0)],
                        ['Cash Out',        fmt(sess.totalCashOutCents ?? 0)],
                        ['Expected Cash',   sess.expectedCashCents != null ? fmt(sess.expectedCashCents) : '—'],
                        ['Closing Cash',    sess.closingCashCents  != null ? fmt(sess.closingCashCents)  : '—'],
                        ['Difference',      diff != null ? `${diff > 0 ? '+' : ''}${fmt(diff)}` : '—'],
                        ['Rate Used',       sess.rateUsed ? `${sess.rateUsed}` : '—'],
                        ['Note',            sess.note || '—'],
                      ].map(([lbl, val], i) => (
                        <View key={lbl} style={[s.detailRow, i > 0 && s.detailRowBorder]}>
                          <AppText style={s.detailLbl}>{lbl}</AppText>
                          <AppText
                            style={[
                              s.detailVal,
                              lbl === 'Difference' && diff != null ? { color: diffColor(diff), fontWeight: '700' } : {},
                            ]}
                            numberOfLines={lbl === 'Note' ? 3 : 1}
                          >
                            {val}
                          </AppText>
                        </View>
                      ))}

                      {/* Inline transactions if available */}
                      {Array.isArray(sess.transactions) && sess.transactions.length > 0 && (
                        <>
                          <View style={[s.sessDetailDivider, { marginTop: 12 }]} />
                          <AppText style={s.txSectionHdr}>Transactions</AppText>
                          {sess.transactions.map((tx, i) => (
                            <View key={String(tx.id ?? i)} style={[s.txRow, i > 0 && s.txRowBorder]}>
                              <View style={[s.txTypeBadge, { backgroundColor: tx.type === 'CASH_IN' ? '#D1FAE5' : tx.type === 'CASH_OUT' ? '#FEE2E2' : '#DBEAFE' }]}>
                                <AppText style={[s.txTypeTxt, { color: txColor(tx.type), fontSize: 9 }]}>
                                  {tx.type.replace('_', '\n')}
                                </AppText>
                              </View>
                              <View style={{ flex: 1, paddingHorizontal: 8 }}>
                                <AppText style={s.txNote} numberOfLines={1}>{tx.note ?? tx.reference ?? '—'}</AppText>
                                <AppText style={s.txDate}>{fmtDate(tx.createdAt)}</AppText>
                              </View>
                              <AppText style={[s.txAmount, { color: txColor(tx.type) }]}>
                                {fmt(tx.amountCents)}
                              </AppText>
                            </View>
                          ))}
                        </>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
            <View style={{ height: 24 }} />
          </ScrollView>
        )
      )}
    </View>
  );
};

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 14 },
  loadBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 40 },
  retryBtn: { backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },

  // Tabs
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab:    { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: Colors.primary },
  tabTxt:    { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTxtActive: { color: Colors.primary },

  // Open session card
  sessionCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: '#4ADE80',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  sessionCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  statusDot:      { width: 9, height: 9, borderRadius: 5 },
  sessionNum:     { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  openBadge:      { backgroundColor: '#D1FAE5', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  openBadgeTxt:   { fontSize: 10, fontWeight: '700', color: '#059669', letterSpacing: 0.3 },
  sessionStats:   { flexDirection: 'row', flexWrap: 'wrap', gap: 0, marginBottom: 8 },
  statItem:       { width: '50%', paddingVertical: 5 },
  statLbl:        { fontSize: 11, color: Colors.textSecondary, marginBottom: 2 },
  statVal:        { fontSize: 14, fontWeight: '700', color: Colors.text },
  sessionDate:    { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },

  // No session
  noSessionCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 24,
    alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  noSessionIcon: { fontSize: 36, color: Colors.textSecondary },
  noSessionTxt:  { fontSize: 15, fontWeight: '700', color: Colors.text },
  noSessionHint: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  // Form card
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  fieldLbl:  { fontSize: 12, fontWeight: '600', color: Colors.text },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 13, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.background,
  },
  inputMulti: { height: 72, textAlignVertical: 'top', paddingTop: 10 },

  // Type selector
  typeRow: { flexDirection: 'row', gap: 10 },
  typeBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  typeBtnIn:  { borderColor: '#059669', backgroundColor: '#ECFDF5' },
  typeBtnOut: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  typeBtnTxt: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  typeBtnTxtActive: { fontWeight: '700' },

  // Alerts
  errBox:     { backgroundColor: '#FEF2F2', borderRadius: 9, padding: 11, borderLeftWidth: 3, borderLeftColor: '#DC2626' },
  errTxt:     { color: '#DC2626', fontSize: 13 },
  successBox: { backgroundColor: '#ECFDF5', borderRadius: 9, padding: 11, borderLeftWidth: 3, borderLeftColor: '#059669' },
  successTxt: { color: '#059669', fontSize: 13, fontWeight: '600' },

  // Submit
  submitBtn:    { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitBtnOut: { backgroundColor: '#DC2626' },
  submitBtnDis: { backgroundColor: Colors.border },
  submitBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  // Transactions list
  txRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  txRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  txTypeBadge: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, minWidth: 46, alignItems: 'center' },
  txTypeTxt:   { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  txNote:      { fontSize: 12, fontWeight: '500', color: Colors.text },
  txDate:      { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  txAmount:    { fontSize: 13, fontWeight: '700' },
  txSectionHdr:{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, marginTop: 2 },

  // Session history cards
  sessCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  sessCardHdr:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sessCardLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  sessCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessNum:       { fontSize: 14, fontWeight: '700', color: Colors.text },
  sessDate:      { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  statusBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeTxt:{ fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  expandArrow:   { fontSize: 10, color: Colors.textSecondary },
  printBtn:      { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  printBtnTxt:   { fontSize: 11, fontWeight: '600', color: Colors.primary },

  sessSummary: { flexDirection: 'row', gap: 0, flexWrap: 'wrap' },
  sessStat:    { flex: 1, minWidth: '25%', paddingVertical: 3, paddingRight: 6 },
  sessStatLbl: { fontSize: 10, color: Colors.textSecondary, marginBottom: 1 },
  sessStatVal: { fontSize: 13, fontWeight: '600', color: Colors.text },

  sessDetail:       { marginTop: 6 },
  sessDetailDivider:{ height: 1, backgroundColor: Colors.border, marginVertical: 10 },
  detailRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailRowBorder:  { borderTopWidth: 1, borderTopColor: Colors.border },
  detailLbl:        { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  detailVal:        { fontSize: 12, fontWeight: '600', color: Colors.text, flex: 1, textAlign: 'right' },
});

export default CashierManageScreen;
