import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SubRow {
  no: number;
  campus: string;
  startCounter: number;
  endCounter: number;
}

export interface InvoiceGroup {
  invoiceNo: string;
  subRows: SubRow[];
  usage: number;
  pricePerPage: number;
  totalPrice: number;
}

export interface SummaryTableData {
  title: string;
  invoiceDate: string;
  groups: InvoiceGroup[];
  grandTotalUsage: number;
  grandTotalPrice: number;
}

// ─── Theme (matches print template) ──────────────────────────────────────────
const HDR_BG  = '#EFF6FF';
const HDR_FG  = '#2563EB';
const ALT_BG  = '#FAFAFA';
const BORDER  = '#e8e8e8';
const HDR_BDR = '#d0d0d0';
const INK     = '#000';
const ROW_H   = 32;

// ─── Column flex weights ──────────────────────────────────────────────────────
const C = {
  no:     0.4,
  invNo:  1.2,
  campus: 1,
  start:  1,
  end:    1,
  usage:  1,
  price:  1.3,
  total:  1.3,
};

// ─── SummaryTable ─────────────────────────────────────────────────────────────
const SummaryTable: React.FC<{ data: SummaryTableData }> = ({ data }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
    <View style={s.wrap}>

      {/* Title */}
      <Text style={s.title}>{data.title}</Text>

      <View style={s.table}>

        {/* ── Header row ── */}
        <View style={s.hdrRow}>
          {([
            { label: 'No',             flex: C.no,    align: 'center' },
            { label: 'Invoice No',     flex: C.invNo, align: 'left'   },
            { label: 'Campus',         flex: C.campus,align: 'center' },
            { label: 'Start\nCounter', flex: C.start, align: 'center' },
            { label: 'End\nCounter',   flex: C.end,   align: 'center' },
            { label: 'Usage',          flex: C.usage, align: 'center' },
            { label: 'Price/page',     flex: C.price, align: 'right'  },
            { label: 'Total Price',    flex: C.total, align: 'right'  },
          ] as { label: string; flex: number; align: string }[]).map((col, i) => (
            <View key={col.label} style={[s.hdrCell, { flex: col.flex }, i > 0 && s.hdrColBdr]}>
              <Text style={[s.hdrTxt, { textAlign: col.align as any }]}>{col.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Data groups ── */}
        {data.groups.map((grp, gIdx) => {
          const bg = gIdx % 2 === 0 ? '#fff' : ALT_BG;
          const n  = grp.subRows.length;
          return (
            <View key={`${grp.invoiceNo}-${gIdx}`} style={[s.groupRow, { backgroundColor: bg }]}>

              {/* No — per sub-row */}
              <View style={{ flex: C.no }}>
                {grp.subRows.map((row, rIdx) => (
                  <View key={rIdx} style={[s.cell, { height: ROW_H }, rIdx < n - 1 && s.rowBdr]}>
                    <Text style={[s.cellTxt, s.cellC]}>{row.no}</Text>
                  </View>
                ))}
              </View>

              {/* Invoice No — merged */}
              <View style={[s.mergedCell, s.colBdr, { flex: C.invNo }]}>
                <Text style={[s.cellTxt, { fontWeight: '700' }]}>{grp.invoiceNo}</Text>
              </View>

              {/* Campus — per sub-row */}
              <View style={[s.colBdr, { flex: C.campus }]}>
                {grp.subRows.map((row, rIdx) => (
                  <View key={rIdx} style={[s.cell, s.cellC, { height: ROW_H }, rIdx < n - 1 && s.rowBdr]}>
                    <Text style={s.cellTxt}>{row.campus}</Text>
                  </View>
                ))}
              </View>

              {/* Start Counter — per sub-row */}
              <View style={[s.colBdr, { flex: C.start }]}>
                {grp.subRows.map((row, rIdx) => (
                  <View key={rIdx} style={[s.cell, s.cellR, { height: ROW_H }, rIdx < n - 1 && s.rowBdr]}>
                    <Text style={s.cellTxt}>{row.startCounter.toLocaleString()}</Text>
                  </View>
                ))}
              </View>

              {/* End Counter — per sub-row */}
              <View style={[s.colBdr, { flex: C.end }]}>
                {grp.subRows.map((row, rIdx) => (
                  <View key={rIdx} style={[s.cell, s.cellR, { height: ROW_H }, rIdx < n - 1 && s.rowBdr]}>
                    <Text style={[s.cellTxt, { fontWeight: '600' }]}>{row.endCounter.toLocaleString()}</Text>
                  </View>
                ))}
              </View>

              {/* Usage — merged */}
              <View style={[s.mergedCell, s.colBdr, s.cellR, { flex: C.usage }]}>
                <Text style={[s.cellTxt, { fontWeight: '700' }]}>{grp.usage.toLocaleString()}</Text>
              </View>

              {/* Price/page — merged */}
              <View style={[s.mergedCell, s.colBdr, s.cellR, { flex: C.price }]}>
                <Text style={s.cellTxt}>${grp.pricePerPage.toFixed(5)}</Text>
              </View>

              {/* Total Price — merged */}
              <View style={[s.mergedCell, s.colBdr, s.cellR, { flex: C.total }]}>
                <Text style={[s.cellTxt, { fontWeight: '700' }]}>${grp.totalPrice.toFixed(2)}</Text>
              </View>

            </View>
          );
        })}

        {/* ── Footer / Total row ── */}
        <View style={s.footRow}>
          {/* "Total Usage" label — spans No + Invoice No + Campus + Start + End */}
          <View style={[s.mergedCell, { flex: C.no + C.invNo + C.campus + C.start + C.end, justifyContent: 'flex-end', paddingRight: 8 }]}>
            <Text style={s.footLbl}>Total Usage</Text>
          </View>
          {/* Grand usage */}
          <View style={[s.mergedCell, s.footColBdr, s.cellR, { flex: C.usage }]}>
            <Text style={s.footNum}>{data.grandTotalUsage.toLocaleString()}</Text>
          </View>
          {/* Grand Total label */}
          <View style={[s.mergedCell, s.footColBdr, { flex: C.price, justifyContent: 'flex-end', paddingRight: 8 }]}>
            <Text style={s.footLbl}>Grand Total</Text>
          </View>
          {/* Grand total price */}
          <View style={[s.mergedCell, s.footColBdr, s.cellR, { flex: C.total }]}>
            <Text style={s.footNum}>${data.grandTotalPrice.toFixed(2)}</Text>
          </View>
        </View>

      </View>
    </View>
  </ScrollView>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  wrap:  { padding: 16 },
  title: { fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 10, color: INK },

  table: { borderWidth: 1, borderColor: HDR_BDR, minWidth: 680, borderRadius: 6, overflow: 'hidden' },

  // Header
  hdrRow:    { flexDirection: 'row', backgroundColor: HDR_BG },
  hdrCell:   { alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 5, borderBottomWidth: 1.5, borderBottomColor: INK },
  hdrColBdr: { borderLeftWidth: 1, borderLeftColor: HDR_BDR },
  hdrTxt:    { color: HDR_FG, fontWeight: '700', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },

  // Group rows
  groupRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: BORDER },

  // Cells
  cell:       { justifyContent: 'center', paddingHorizontal: 5 },
  cellC:      { alignItems: 'center' },
  cellR:      { alignItems: 'flex-end', paddingHorizontal: 6 },
  cellTxt:    { fontSize: 11, color: INK },
  mergedCell: { justifyContent: 'center', paddingHorizontal: 6 },

  // Separators
  colBdr:  { borderLeftWidth: 1, borderLeftColor: BORDER },
  rowBdr:  { borderBottomWidth: 1, borderBottomColor: BORDER },

  // Footer row
  footRow:    { flexDirection: 'row', backgroundColor: HDR_BG, borderTopWidth: 2, borderTopColor: INK, minHeight: ROW_H + 4 },
  footColBdr: { borderLeftWidth: 1, borderLeftColor: 'rgba(37,99,235,0.25)' },
  footLbl:    { fontSize: 10, fontWeight: '700', color: HDR_FG },
  footNum:    { fontSize: 11, fontWeight: '800', color: INK },
});

export default SummaryTable;
