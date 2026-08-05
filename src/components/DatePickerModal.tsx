import React, { useState, useEffect } from 'react';
import {
  View, Modal, TouchableOpacity, StyleSheet, FlatList,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../theme/colors';
import AppText from './AppText';

interface Props {
  visible: boolean;
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
  minDate?: Date;
  maxDate?: Date;
  noModal?: boolean;
  inline?: boolean;
}

const DAYS   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth()    === b.getMonth()    &&
  a.getDate()     === b.getDate();

const startOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();
const daysInMonth  = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

const DatePickerModal: React.FC<Props> = ({ visible, value, onChange, onClose, minDate, maxDate, noModal, inline }) => {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());
  const [selected,  setSelected]  = useState<Date>(value);

  useEffect(() => {
    if (visible) {
      setViewYear(value.getFullYear());
      setViewMonth(value.getMonth());
      setSelected(value);
    }
  }, [visible, value]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else { setViewMonth(m => m - 1); }
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else { setViewMonth(m => m + 1); }
  };

  const totalDays  = daysInMonth(viewYear, viewMonth);
  const startDay   = startOfMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(startDay).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const isDisabled = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  };

  const handleDay = (day: number) => {
    if (isDisabled(day)) return;
    setSelected(new Date(viewYear, viewMonth, day));
  };

  const handleOk = () => {
    onChange(selected);
    onClose();
  };

  const calendarCard = (
    <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>

      {/* Month / Year navigation */}
      <View style={styles.header}>
        <TouchableOpacity onPress={prevMonth} style={styles.navBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-left" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <AppText style={styles.monthLabel}>{MONTHS[viewMonth]} {viewYear}</AppText>
        <TouchableOpacity onPress={nextMonth} style={styles.navBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-right" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Day-of-week headers */}
      <View style={styles.dayRow}>
        {DAYS.map(d => (
          <AppText key={d} style={styles.dayHeader}>{d}</AppText>
        ))}
      </View>

      {/* Calendar grid */}
      {rows.map((row, ri) => (
        <View key={ri} style={styles.dayRow}>
          {row.map((day, ci) => {
            if (!day) return <View key={ci} style={styles.dayCell} />;
            const cellDate  = new Date(viewYear, viewMonth, day);
            const isToday   = isSameDay(cellDate, today);
            const isSel     = isSameDay(cellDate, selected);
            const disabled  = isDisabled(day);
            return (
              <TouchableOpacity
                key={ci}
                style={[styles.dayCell, isSel && styles.dayCellSelected, isToday && !isSel && styles.dayCellToday]}
                onPress={() => handleDay(day)}
                activeOpacity={0.7}
                disabled={disabled}
              >
                <AppText style={[
                  styles.dayCellText,
                  isSel     && styles.dayCellTextSelected,
                  isToday && !isSel && styles.dayCellTextToday,
                  disabled  && styles.dayCellTextDisabled,
                ]}>
                  {day}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={onClose} style={styles.footerBtn}>
          <AppText style={styles.cancelText}>Cancel</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setSelected(today); setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
          style={styles.footerBtn}
        >
          <AppText style={styles.todayText}>Today</AppText>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleOk} style={[styles.footerBtn, styles.okBtn]}>
          <AppText style={styles.okText}>OK</AppText>
        </TouchableOpacity>
      </View>

    </TouchableOpacity>
  );

  if (inline) {
    if (!visible) return null;
    return <View style={{ marginTop: 8 }}>{calendarCard}</View>;
  }

  if (noModal) {
    if (!visible) return null;
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
        {calendarCard}
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        {calendarCard}
      </TouchableOpacity>
    </Modal>
  );
};

const CELL = 38;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 16,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navBtn: { padding: 4 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: Colors.text },
  dayRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 2 },
  dayHeader: {
    width: CELL,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    paddingVertical: 4,
  },
  dayCell: {
    width: CELL,
    height: CELL,
    borderRadius: CELL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: { backgroundColor: Colors.primary },
  dayCellToday: { borderWidth: 1.5, borderColor: Colors.primary },
  dayCellText: { fontSize: 14, color: Colors.text },
  dayCellTextSelected: { color: '#fff', fontWeight: '700' },
  dayCellTextToday: { color: Colors.primary, fontWeight: '700' },
  dayCellTextDisabled: { color: Colors.textLight },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 14,
    gap: 4,
  },
  footerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  okBtn: { backgroundColor: Colors.primary },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  todayText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  okText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

export default DatePickerModal;
