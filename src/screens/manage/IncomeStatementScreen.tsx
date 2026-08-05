import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import * as Print from 'expo-print';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import DatePickerModal from '../../components/DatePickerModal';
import LOGO_BASE64 from '../../logo/logoBase64';
import { getIncomeStatementApi, ApiIncomeStatement, ApiIncomeStatementLine } from '../../services/focusApi';
import { exportIncomeStatementExcel } from '../../utils/incomeStatementExcel';

interface Props {
  onBack: () => void;
}

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtMoney = (cents: number): string => {
  const abs = Math.abs(cents / 100);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `($${formatted})` : `$${formatted}`;
};

const fmtMoneyAbs = (cents: number): string => {
  const abs = Math.abs(cents / 100);
  return `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtPercent = (value: number | null): string =>
  value === null ? 'N/A' : `${value.toFixed(1)}%`;

const fmtDateLabel = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const MONTHS_LONG = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ── Expense category colors ───────────────────────────────────────────────────

const CHART_PALETTE = [
  '#2563EB', '#7C3AED', '#F59E0B', '#10B981', '#EF4444',
  '#06B6D4', '#F97316', '#EC4899', '#8B5CF6', '#64748B',
];

const catColor = (index: number) => CHART_PALETTE[index % CHART_PALETTE.length];

// ── Bar Chart Component ───────────────────────────────────────────────────────

const ExpenseBarChart: React.FC<{ lines: ApiIncomeStatementLine[]; totalCents: number }> = ({ lines, totalCents }) => {
  if (!lines.length || totalCents === 0) return null;

  const CHART_W = 300;
  const BAR_H   = 22;
  const GAP      = 8;
  const LABEL_W  = 90;

  return (
    <View style={styles.chartWrap}>
      {lines.map((line, i) => {
        const pct = totalCents > 0 ? line.amountCents / totalCents : 0;
        const barW = Math.max(2, Math.round(pct * CHART_W));
        const color = catColor(i);
        return (
          <View key={line.key} style={styles.chartRow}>
            {/* Category label */}
            <View style={[styles.chartLabel, { width: LABEL_W }]}>
              <View style={[styles.chartDot, { backgroundColor: color }]} />
              <AppText style={styles.chartLabelText} numberOfLines={1}>{line.nameEn}</AppText>
            </View>

            {/* Bar */}
            <View style={styles.chartBarTrack}>
              <View style={[styles.chartBarFill, { width: `${(pct * 100).toFixed(1)}%` as any, backgroundColor: color }]} />
            </View>

            {/* Amount + pct */}
            <View style={styles.chartAmtCol}>
              <AppText style={styles.chartAmt}>{fmtMoneyAbs(line.amountCents)}</AppText>
              <AppText style={styles.chartPct}>{(pct * 100).toFixed(1)}%</AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const IncomeStatementScreen: React.FC<Props> = ({ onBack }) => {
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const monthLabel = `${MONTHS_LONG[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`;
  const prevMonth = () => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const [report,    setReport]   = useState<ApiIncomeStatement | null>(null);
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState<string | null>(null);
  const [printing,  setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = toISO(selectedMonth);
      const to = toISO(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0));
      const result = await getIncomeStatementApi(from, to);
      setReport(result);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load income statement');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  const netProfitMargin = (r: ApiIncomeStatement): number | null =>
    r.revenue.total > 0 ? (r.netProfit / r.revenue.total) * 100 : null;

  // ── PDF builder ───────────────────────────────────────────────────────────

  const buildHTML = (r: ApiIncomeStatement): string => {
    const margin = netProfitMargin(r);
    const netColor = r.netProfit >= 0 ? '#16A34A' : '#DC2626';
    const marginColor = margin === null ? '#666' : margin >= 0 ? '#16A34A' : '#DC2626';

    const expRows = r.operatingExpenses.lines
      .filter(l => l.amountCents > 0)
      .map((l, i) => {
        const pct = r.operatingExpenses.total > 0 ? (l.amountCents / r.operatingExpenses.total * 100).toFixed(1) : '0.0';
        return `
        <tr>
          <td style="padding:6px 12px;color:#555;">${l.nameEn}</td>
          <td style="padding:6px 12px;text-align:right;color:#111;">${fmtMoneyAbs(l.amountCents)}</td>
          <td style="padding:6px 12px;text-align:right;color:#999;font-size:11px;">${pct}%</td>
        </tr>`;
      }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body{font-family:sans-serif;padding:32px;color:#111;font-size:13px;}
  h1{font-size:20px;font-weight:800;margin:0 0 4px;}
  .subtitle{color:#666;font-size:12px;margin-bottom:24px;}
  .logo{display:block;margin:0 auto 12px;width:72px;height:72px;object-fit:contain;}
  .section{margin-bottom:20px;}
  .section-title{font-size:13px;font-weight:700;letter-spacing:.5px;color:#333;
    text-transform:uppercase;border-bottom:2px solid #E5E7EB;padding-bottom:4px;margin-bottom:8px;}
  table{width:100%;border-collapse:collapse;}
  tr.total td{font-weight:700;border-top:1px solid #D1D5DB;padding-top:8px;}
  .gross td,.net td,.margin-row td{background:#F3F4F6;font-weight:700;}
  .profit td{color:${netColor};}
  .legend{background:#F9FAFB;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:11px;color:#555;}
  .legend-title{font-weight:700;color:#333;margin-bottom:6px;}
  .legend-item{margin-bottom:3px;}
</style>
</head><body>
<img class="logo" src="${LOGO_BASE64}" />
<h1 style="text-align:center;">Income Statement</h1>
<p class="subtitle" style="text-align:center;">${fmtDateLabel(r.from)} – ${fmtDateLabel(r.to)}</p>

<div class="section">
  <div class="section-title">Revenue</div>
  <table>
    <tr><td style="padding:5px 12px;">Sales</td><td style="padding:5px 12px;text-align:right;">${fmtMoneyAbs(r.revenue.sales)}</td></tr>
    <tr><td style="padding:5px 12px;">Rental</td><td style="padding:5px 12px;text-align:right;">${fmtMoneyAbs(r.revenue.rental)}</td></tr>
    <tr class="total"><td style="padding:8px 12px;">Total Revenue</td><td style="padding:8px 12px;text-align:right;">${fmtMoneyAbs(r.revenue.total)}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">Cost of Goods Sold</div>
  <table>
    <tr><td style="padding:5px 12px;">COGS</td><td style="padding:5px 12px;text-align:right;color:#DC2626;">(${fmtMoneyAbs(r.cogs)})</td></tr>
  </table>
</div>

<div class="section">
  <table>
    <tr class="gross">
      <td style="padding:10px 12px;font-size:14px;">Gross Profit</td>
      <td style="padding:10px 12px;text-align:right;font-size:14px;color:${r.grossProfit >= 0 ? '#16A34A' : '#DC2626'};">${fmtMoney(r.grossProfit)}</td>
    </tr>
  </table>
</div>

<div class="section">
  <div class="section-title">Operating Expenses</div>
  <table>
    ${expRows}
    <tr class="total"><td style="padding:8px 12px;">Total Expenses</td><td style="padding:8px 12px;text-align:right;color:#DC2626;">(${fmtMoneyAbs(r.operatingExpenses.total)})</td></tr>
  </table>
</div>

<div class="section">
  <table>
    <tr class="gross">
      <td style="padding:10px 12px;font-size:14px;">Operating Income</td>
      <td style="padding:10px 12px;text-align:right;font-size:14px;color:${r.operatingIncome >= 0 ? '#16A34A' : '#DC2626'};">${fmtMoney(r.operatingIncome)}</td>
    </tr>
  </table>
</div>

${(r.otherIncomeExpenses.interestIncome > 0 || r.otherIncomeExpenses.interestExpense > 0) ? `
<div class="section">
  <div class="section-title">Other Income / Expenses</div>
  <table>
    ${r.otherIncomeExpenses.interestIncome > 0 ? `<tr><td style="padding:5px 12px;">Interest Income</td><td style="padding:5px 12px;text-align:right;">${fmtMoneyAbs(r.otherIncomeExpenses.interestIncome)}</td></tr>` : ''}
    ${r.otherIncomeExpenses.interestExpense > 0 ? `<tr><td style="padding:5px 12px;">Interest Expense</td><td style="padding:5px 12px;text-align:right;color:#DC2626;">(${fmtMoneyAbs(r.otherIncomeExpenses.interestExpense)})</td></tr>` : ''}
    <tr class="total"><td style="padding:8px 12px;">Net Other</td><td style="padding:8px 12px;text-align:right;">${fmtMoney(r.otherIncomeExpenses.net)}</td></tr>
  </table>
</div>` : ''}

<div class="section">
  <div class="section-title">Before Tax</div>
  <table>
    <tr><td style="padding:5px 12px;">Income Before Tax</td><td style="padding:5px 12px;text-align:right;">${fmtMoney(r.incomeBeforeTax)}</td></tr>
    <tr class="total"><td style="padding:8px 12px;">Income Tax</td><td style="padding:8px 12px;text-align:right;color:#DC2626;">(${fmtMoneyAbs(r.incomeTax)})</td></tr>
  </table>
</div>

<div class="section">
  <table>
    <tr class="net profit">
      <td style="padding:12px;font-size:16px;font-weight:800;">Net Profit</td>
      <td style="padding:12px;text-align:right;font-size:16px;font-weight:800;color:${netColor};">${fmtMoney(r.netProfit)}</td>
    </tr>
    <tr class="margin-row">
      <td style="padding:8px 12px;font-size:13px;">Net Profit Margin</td>
      <td style="padding:8px 12px;text-align:right;font-size:14px;font-weight:700;color:${marginColor};">${fmtPercent(margin)}</td>
    </tr>
  </table>
</div>

<div class="legend">
  <div class="legend-title">Legend</div>
  <div class="legend-item"><b>Bold black</b> = Calculated formula (auto-computed)</div>
  <div class="legend-item"><span style="color:#DC2626;">(Amount)</span> = Negative / expense value</div>
  <div class="legend-item">— = Zero / no value</div>
  <div class="legend-item">N/A = Cannot be calculated (e.g. zero revenue)</div>
</div>
</body></html>`;
  };

  const handlePrint = async () => {
    if (!report) return;
    setPrinting(true);
    try {
      const html = buildHTML(report);
      const from = toISO(selectedMonth);
      const to = toISO(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0));
      const name = `IncomeStatement-${from}-${to}`;
      const result = await Print.printToFileAsync({ html, width: 595, height: 842 });
      await Share.share({ url: result.uri, title: 'Income Statement' });
    } catch (err: any) {
      Alert.alert('Export Error', err?.message ?? 'Failed to generate PDF');
    } finally {
      setPrinting(false);
    }
  };

  const handleExcelExport = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const from = toISO(selectedMonth);
      const to = toISO(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0));
      await exportIncomeStatementExcel(report, from, to);
    } catch (err: any) {
      Alert.alert('Export Error', err?.message ?? 'Failed to generate Excel file');
    } finally {
      setExporting(false);
    }
  };

  const netColor   = report ? (report.netProfit >= 0   ? Colors.success : Colors.error) : Colors.text;
  const grossColor = report ? (report.grossProfit >= 0  ? Colors.success : Colors.error) : Colors.text;
  const opColor    = report ? (report.operatingIncome >= 0 ? Colors.success : Colors.error) : Colors.text;
  const margin     = report ? netProfitMargin(report) : null;
  const marginColor = margin === null ? Colors.textSecondary : margin >= 0 ? Colors.success : Colors.error;

  return (
    <View style={styles.root}>
      <AppBar title="Income Statement" titleAlign="left" showBack onBack={onBack} />

      {/* ── Filter bar ── */}
      <View style={styles.filterBar}>
        <TouchableOpacity onPress={prevMonth} style={styles.monthNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="chevron-left" size={26} color={Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.monthPill} onPress={() => setShowMonthPicker(true)} activeOpacity={0.7}>
          <Icon name="event" size={14} color={Colors.primary} />
          <AppText style={styles.monthPillText}>{monthLabel}</AppText>
        </TouchableOpacity>
        <TouchableOpacity onPress={nextMonth} style={styles.monthNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="chevron-right" size={26} color={Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.runBtn} onPress={load} disabled={loading} activeOpacity={0.85}>
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Icon name="bar-chart" size={15} color="#fff" /><AppText style={styles.runBtnText}>Run</AppText></>}
        </TouchableOpacity>
      </View>

      {/* ── Content ── */}
      {error ? (
        <View style={styles.center}>
          <Icon name="error-outline" size={48} color={Colors.textLight} />
          <AppText style={styles.centerMsg}>{error}</AppText>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <AppText style={{ color: Colors.primary, fontWeight: '600' }}>Retry</AppText>
          </TouchableOpacity>
        </View>
      ) : !report ? (
        <View style={styles.center}>
          <Icon name="bar-chart" size={64} color={Colors.textLight} />
          <AppText style={styles.emptyTitle}>No Report Yet</AppText>
          <AppText style={styles.emptyMsg}>Select a date range and tap Run.</AppText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Period header */}
          <View style={styles.periodBanner}>
            <Icon name="date-range" size={16} color={Colors.primary} />
            <AppText style={styles.periodText}>
              {fmtDateLabel(report.from)} – {fmtDateLabel(report.to)}
            </AppText>
          </View>

          {/* ── Revenue ── */}
          <Section title="Revenue" icon="trending-up" color="#16A34A">
            <Row label="Sales"         value={fmtMoneyAbs(report.revenue.sales)} />
            <Row label="Rental"        value={fmtMoneyAbs(report.revenue.rental)} />
            <TotalRow label="Total Revenue" value={fmtMoneyAbs(report.revenue.total)} />
          </Section>

          {/* ── COGS ── */}
          <Section title="Cost of Goods Sold" icon="inventory" color="#F59E0B">
            <Row label="COGS" value={`(${fmtMoneyAbs(report.cogs)})`} valueColor={Colors.error} />
          </Section>

          {/* ── Gross Profit ── */}
          <HighlightCard
            label="Gross Profit"
            value={fmtMoney(report.grossProfit)}
            valueColor={grossColor}
          />

          {/* ── Operating Expenses ── */}
          <Section title="Operating Expenses" icon="receipt" color="#7C3AED">
            {report.operatingExpenses.lines.filter(l => l.amountCents > 0).map(l => (
              <Row key={l.key} label={l.nameEn} value={fmtMoneyAbs(l.amountCents)} />
            ))}
            <TotalRow
              label="Total Expenses"
              value={`(${fmtMoneyAbs(report.operatingExpenses.total)})`}
              valueColor={Colors.error}
            />
          </Section>

          {/* ── Expense Breakdown Chart ── */}
          {report.operatingExpenses.lines.filter(l => l.amountCents > 0).length > 0 && (
            <Section title="Expense Breakdown" icon="pie-chart" color="#7C3AED">
              <ExpenseBarChart
                lines={report.operatingExpenses.lines.filter(l => l.amountCents > 0)}
                totalCents={report.operatingExpenses.total}
              />
            </Section>
          )}

          {/* ── Operating Income ── */}
          <HighlightCard
            label="Operating Income"
            value={fmtMoney(report.operatingIncome)}
            valueColor={opColor}
          />

          {/* ── Other Income / Expenses ── */}
          {(report.otherIncomeExpenses.interestIncome > 0 || report.otherIncomeExpenses.interestExpense > 0) && (
            <Section title="Other Income / Expenses" icon="swap-horiz" color="#F59E0B">
              {report.otherIncomeExpenses.interestIncome > 0 && (
                <Row label="Interest Income" value={fmtMoneyAbs(report.otherIncomeExpenses.interestIncome)} />
              )}
              {report.otherIncomeExpenses.interestExpense > 0 && (
                <Row
                  label="Interest Expense"
                  value={`(${fmtMoneyAbs(report.otherIncomeExpenses.interestExpense)})`}
                  valueColor={Colors.error}
                />
              )}
              <TotalRow
                label="Net Other"
                value={fmtMoney(report.otherIncomeExpenses.net)}
                valueColor={report.otherIncomeExpenses.net >= 0 ? undefined : Colors.error}
              />
            </Section>
          )}

          {/* ── Before Tax ── */}
          <Section title="Before Tax" icon="account-balance" color="#0284C7">
            <Row label="Income Before Tax" value={fmtMoney(report.incomeBeforeTax)} />
            <TotalRow
              label="Income Tax"
              value={`(${fmtMoneyAbs(report.incomeTax)})`}
              valueColor={Colors.error}
            />
          </Section>

          {/* ── Net Profit ── */}
          <View style={[styles.highlightCard, styles.netCard, { borderColor: netColor }]}>
            <View style={{ flex: 1 }}>
              <AppText style={[styles.highlightLabel, { fontSize: 16 }]}>Net Profit</AppText>
              <AppText style={[styles.highlightValue, { fontSize: 26, color: netColor, marginTop: 2 }]}>
                {fmtMoney(report.netProfit)}
              </AppText>
            </View>
            {/* Net Profit Margin */}
            <View style={[styles.marginBadge, { borderColor: marginColor, backgroundColor: `${marginColor}15` }]}>
              <AppText style={[styles.marginPct, { color: marginColor }]}>
                {fmtPercent(margin)}
              </AppText>
              <AppText style={[styles.marginLabel, { color: marginColor }]}>margin</AppText>
            </View>
          </View>

          {/* ── Legend ── */}
          <View style={styles.legendCard}>
            <View style={styles.legendHeader}>
              <Icon name="info-outline" size={15} color={Colors.textSecondary} />
              <AppText style={styles.legendTitle}>Legend</AppText>
            </View>
            <LegendItem dot="#000" label="Bold black = Auto-calculated formula" />
            <LegendItem dot={Colors.error} label="(Amount) = Negative / expense value" />
            <LegendItem dot={Colors.textSecondary} label="— = Zero / no value" />
            <LegendItem dot={Colors.textLight} label="N/A = Cannot calculate (e.g. zero revenue)" />
          </View>

          {/* ── Export buttons ── */}
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportBtn, { backgroundColor: '#16A34A' }]}
              onPress={handleExcelExport}
              disabled={exporting}
              activeOpacity={0.85}
            >
              {exporting
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Icon name="table-chart" size={16} color="#fff" /><AppText style={styles.exportBtnText}>Excel</AppText></>}
            </TouchableOpacity>
          </View>

        </ScrollView>
      )}

      {/* Month picker */}
      <DatePickerModal
        visible={showMonthPicker}
        value={selectedMonth}
        onChange={d => { setSelectedMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setShowMonthPicker(false); }}
        onClose={() => setShowMonthPicker(false)}
      />
    </View>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; icon: string; color: string; children: React.ReactNode }> = ({ title, icon, color, children }) => (
  <View style={styles.section}>
    <View style={[styles.sectionHeader, { borderLeftColor: color }]}>
      <Icon name={icon as any} size={15} color={color} />
      <AppText style={[styles.sectionTitle, { color }]}>{title}</AppText>
    </View>
    {children}
  </View>
);

const Row: React.FC<{ label: string; value: string; valueColor?: string }> = ({ label, value, valueColor }) => (
  <View style={styles.row}>
    <AppText style={styles.rowLabel}>{label}</AppText>
    <AppText style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</AppText>
  </View>
);

const TotalRow: React.FC<{ label: string; value: string; valueColor?: string }> = ({ label, value, valueColor }) => (
  <View style={[styles.row, styles.totalRow]}>
    <AppText style={styles.totalRowLabel}>{label}</AppText>
    <AppText style={[styles.totalRowValue, valueColor ? { color: valueColor } : null]}>{value}</AppText>
  </View>
);

const HighlightCard: React.FC<{ label: string; value: string; valueColor: string }> = ({ label, value, valueColor }) => (
  <View style={styles.highlightCard}>
    <AppText style={styles.highlightLabel}>{label}</AppText>
    <AppText style={[styles.highlightValue, { color: valueColor }]}>{value}</AppText>
  </View>
);

const LegendItem: React.FC<{ dot: string; label: string }> = ({ dot, label }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: dot }]} />
    <AppText style={styles.legendItemText}>{label}</AppText>
  </View>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  monthNavBtn: { padding: 4 },
  monthPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  monthPillText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    minWidth: 72,
    justifyContent: 'center',
  },
  runBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  scroll: { padding: 16, paddingBottom: 48, gap: 12 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerMsg: { color: Colors.textSecondary, textAlign: 'center', fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyMsg: { fontSize: 14, color: Colors.textSecondary },
  retryBtn: {
    paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary,
  },

  periodBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryMuted,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  periodText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  section: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    borderLeftWidth: 4,
    backgroundColor: Colors.background,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  rowLabel: { fontSize: 14, color: Colors.textSecondary },
  rowValue: { fontSize: 14, fontWeight: '600', color: Colors.text },

  totalRow: {
    borderBottomWidth: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: 12,
    backgroundColor: Colors.background,
  },
  totalRowLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  totalRowValue: { fontSize: 15, fontWeight: '800', color: Colors.text },

  highlightCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  highlightLabel: { fontSize: 15, fontWeight: '700', color: Colors.text },
  highlightValue: { fontSize: 20, fontWeight: '800' },

  // Net profit card (overrides highlight card with extra margin badge)
  netCard: { marginTop: 4, alignItems: 'flex-start' },

  marginBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 76,
  },
  marginPct: { fontSize: 18, fontWeight: '800' },
  marginLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, marginTop: 1, textTransform: 'uppercase' },

  // Legend
  legendCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 8,
  },
  legendHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  legendTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendItemText: { fontSize: 12, color: Colors.textSecondary, flex: 1 },

  // Export
  exportRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
  },
  exportBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Expense breakdown chart
  chartWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 10 },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chartLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chartDot: { width: 8, height: 8, borderRadius: 4 },
  chartLabelText: { fontSize: 11, color: Colors.text, fontWeight: '600' },
  chartBarTrack: {
    flex: 1,
    height: 14,
    backgroundColor: Colors.background,
    borderRadius: 7,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  chartBarFill: { height: '100%', borderRadius: 7, minWidth: 4 },
  chartAmtCol: { alignItems: 'flex-end', minWidth: 80 },
  chartAmt: { fontSize: 11, fontWeight: '700', color: Colors.text },
  chartPct: { fontSize: 10, color: Colors.textSecondary },
});

export default IncomeStatementScreen;
