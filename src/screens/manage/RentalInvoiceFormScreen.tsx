import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import {
  getRentalContractsApi,
  getCampusesApi,
  createRentalInvoiceApi,
  getRentalInvoiceHeadersApi,
  RentalCampusInput,
  ApiRentalContract,
  ApiRentalInvoiceHeader,
  ApiCampus,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onSaved: () => void;
}

// ─── State types ──────────────────────────────────────────────────────────────
interface MachineEntry {
  key: string;
  contractRef: string;
  counterBwStart: string;
  counterBwEnd: string;
  amountUsd: string;
  errors: Record<string, string>;
}

interface CampusEntry {
  key: string;
  campusId: number | null;
  campusName: string;
  campusCode: string;
  campusError: string;
  machines: MachineEntry[];
}

// ─── Date picker helpers ──────────────────────────────────────────────────────
const DP_ITEM_H  = 44;
const DP_YEARS   = Array.from({ length: 16 }, (_, i) => 2020 + i);
const DP_MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const getDaysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
type PickerTarget = 'issuedAt' | 'dueAt' | 'startDate' | 'endDate';

const CAMPUS_ACCENTS   = ['#2563EB','#10B981','#F59E0B','#7C3AED','#EF4444','#06B6D4'];
const CAMPUS_ACCENT_BG = ['#EFF6FF','#F0FDF4','#FFFBEB','#F5F3FF','#FFF1F2','#ECFEFF'];

const API_ERROR_MESSAGES: Record<string, string> = {
  'error.common.not_found':
    'A required record was not found (campus, contract, customer, or rate config).',
  'error.common.duplicate':
    'A rental invoice for this period already exists for one of the selected campuses.',
  'error.common.validation':
    'Some fields failed server validation. Please review your inputs.',
  'error.common.forbidden': 'You do not have permission to create rental invoices.',
  'error.common.unauthorized': 'Your session has expired. Please log in again.',
  'error.rental.contract_not_found':
    'One or more contract references were not found. Please check the contract ref and try again.',
};
const translateApiError = (raw: string | undefined): string => {
  if (!raw) return 'Failed to create rental invoice. Please try again.';
  return API_ERROR_MESSAGES[raw] ?? raw;
};

let keyCounter = 0;
const newKey = () => String(++keyCounter);

const newMachine = (): MachineEntry => ({
  key: newKey(), contractRef: '', counterBwStart: '', counterBwEnd: '', amountUsd: '', errors: {},
});

const newCampus = (): CampusEntry => ({
  key: newKey(), campusId: null, campusName: '', campusCode: '', campusError: '', machines: [newMachine()],
});

// ─── Component ────────────────────────────────────────────────────────────────
const RentalInvoiceFormScreen: React.FC<Props> = ({ onBack, onSaved }) => {
  const { showAlert } = useAlert();

  // Contracts from API (for pickers)
  const [allContracts, setAllContracts]         = useState<ApiRentalContract[]>([]);
  const [allRentalInvoices, setAllRentalInvoices] = useState<ApiRentalInvoiceHeader[]>([]);
  const [allCampuses, setAllCampuses]           = useState<ApiCampus[]>([]);
  const [contractsLoading, setContractsLoading] = useState(true);
  const [contractsError, setContractsError]     = useState<string | null>(null);

  // Header fields
  const [issuedAt, setIssuedAt]         = useState('');
  const [dueAt, setDueAt]               = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [startDate, setStartDate]       = useState('');
  const [endDate, setEndDate]           = useState('');
  const [rateUsed, setRateUsed]         = useState('4100');
  const [pricePerPage, setPricePerPage] = useState('0.00435');
  const [note, setNote]                 = useState('');
  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({});

  // Campus entries
  const [campuses, setCampuses]           = useState<CampusEntry[]>([newCampus()]);
  const [submitting, setSubmitting]       = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [confirmError, setConfirmError]   = useState<{ raw: string; detail?: string } | null>(null);

  // Campus picker modal
  const [campusPickerIdx, setCampusPickerIdx]   = useState<number | null>(null);
  const [campusPickerSearch, setCampusPickerSearch] = useState('');

  // Contract picker modal (per machine)
  const [contractPicker, setContractPicker] = useState<{ campusIdx: number; machineIdx: number } | null>(null);
  const [contractPickerSearch, setContractPickerSearch] = useState('');

  // Date picker
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [dpYear,  setDpYear]  = useState(new Date().getFullYear());
  const [dpMonth, setDpMonth] = useState(new Date().getMonth() + 1);
  const [dpDay,   setDpDay]   = useState(new Date().getDate());
  const dpYearRef  = useRef<ScrollView>(null);
  const dpMonthRef = useRef<ScrollView>(null);
  const dpDayRef   = useRef<ScrollView>(null);

  // ── Load contracts + campuses ────────────────────────────────────────────────
  const loadContracts = useCallback(() => {
    setContractsLoading(true);
    setContractsError(null);
    Promise.all([getRentalContractsApi(), getCampusesApi(), getRentalInvoiceHeadersApi()])
      .then(([contracts, campuses, invoices]) => {
        const seen = new Set<string>();
        setAllContracts(contracts.filter(c => { const k = String(c.id); if (seen.has(k)) return false; seen.add(k); return true; }));
        setAllCampuses(campuses);
        setAllRentalInvoices(invoices);
      })
      .catch(err => {
        const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to load data';
        setContractsError(msg);
      })
      .finally(() => setContractsLoading(false));
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  // Auto-fill start/end/due date from period month
  useEffect(() => {
    if (!issuedAt) return;
    const [y, m] = issuedAt.substring(0, 7).split('-').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(y, m, 0).getDate();
    setStartDate(`${y}-${pad(m)}-01`);
    setEndDate(`${y}-${pad(m)}-${pad(lastDay)}`);
    const due = new Date(y, m - 1, lastDay);
    due.setDate(due.getDate() + 30);
    setDueAt(`${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`);
  }, [issuedAt]);

  // API returns items newest-first; first match per contract is the most recent end counter.
  const getLastCounter = useCallback((campusCode: string, contractRef: string): string => {
    for (const inv of allRentalInvoices) {
      const lines: any[] = (inv as any).lines ?? inv.details ?? [];
      for (const d of lines) {
        const dCampus: string = d.campusCode ?? d.campus?.campusCode ?? '';
        const dContract: string = d.lineLabel ?? d.contractRef ?? '';
        if (dCampus === campusCode && dContract === contractRef && d.counterBwEnd != null) {
          return String(d.counterBwEnd);
        }
      }
    }
    return '';
  }, [allRentalInvoices]);

  // Unique campuses — prefer the dedicated /campuses API, fall back to contract data
  const availableCampuses = useMemo(() => {
    if (allCampuses.length > 0) {
      return allCampuses.map(c => ({
        campusId:   Number(c.id),
        campusCode: c.campusCode,
        campusName: c.nameEn,
      }));
    }
    // Fallback: derive from contracts if campus API returned nothing
    const map = new Map<number, { campusId: number; campusCode: string; campusName: string }>();
    allContracts.forEach(c => {
      if (!map.has(c.campusId)) {
        map.set(c.campusId, {
          campusId:   c.campusId,
          campusCode: c.campus?.campusCode ?? String(c.campusId),
          campusName: c.campus?.nameEn     ?? `Campus ${c.campusId}`,
        });
      }
    });
    return Array.from(map.values());
  }, [allCampuses, allContracts]);

  // Contracts for the campus currently being picked
  const contractsForPicker = useMemo(() => {
    if (contractPicker === null) return [];
    const campus = campuses[contractPicker.campusIdx];
    if (!campus?.campusCode) return [];
    const q = contractPickerSearch.trim().toLowerCase();
    return allContracts
      .filter(c => {
        if (c.campus?.campusCode && campus.campusCode) {
          return c.campus.campusCode === campus.campusCode;
        }
        return campus.campusId != null && c.campusId === campus.campusId;
      })
      .filter(c => !q || c.referenceNumber.toLowerCase().includes(q) ||
        (c.assetBrand ?? '').toLowerCase().includes(q) ||
        (c.assetModel ?? '').toLowerCase().includes(q));
  }, [contractPicker, campuses, allContracts, contractPickerSearch]);

  // ── Date picker ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pickerTarget) return;
    const yIdx = DP_YEARS.indexOf(dpYear);
    setTimeout(() => {
      dpYearRef.current?.scrollTo({ y: yIdx * DP_ITEM_H, animated: false });
      dpMonthRef.current?.scrollTo({ y: (dpMonth - 1) * DP_ITEM_H, animated: false });
      dpDayRef.current?.scrollTo({ y: (dpDay - 1) * DP_ITEM_H, animated: false });
    }, 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerTarget]);

  const openDatePicker = (target: PickerTarget) => {
    const existing =
      target === 'issuedAt' ? issuedAt :
      target === 'dueAt'    ? dueAt    :
      target === 'startDate'? startDate :
                              endDate;
    if (/^\d{4}-\d{2}-\d{2}$/.test(existing)) {
      const [y, m, d] = existing.split('-').map(Number);
      setDpYear(y); setDpMonth(m); setDpDay(d);
    } else {
      const now = new Date();
      setDpYear(now.getFullYear()); setDpMonth(now.getMonth() + 1); setDpDay(now.getDate());
    }
    setPickerTarget(target);
  };

  const confirmDatePicker = () => {
    const mm = String(dpMonth).padStart(2, '0');
    const safeDay = Math.min(dpDay, getDaysInMonth(dpYear, dpMonth));
    const dateStr = `${dpYear}-${mm}-${String(safeDay).padStart(2, '0')}`;
    if (pickerTarget === 'issuedAt')   setIssuedAt(dateStr);
    else if (pickerTarget === 'dueAt') setDueAt(dateStr);
    else if (pickerTarget === 'startDate') setStartDate(dateStr);
    else if (pickerTarget === 'endDate')   setEndDate(dateStr);
    setPickerTarget(null);
  };

  const formatDateLabel = (val: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
    const [y, m, d] = val.split('-').map(Number);
    return `${d} ${DP_MONTHS[m - 1]} ${y}`;
  };

  const issuedAtLabel  = formatDateLabel(issuedAt)  ?? 'Select date (optional)';
  const dueAtLabel     = formatDateLabel(dueAt)      ?? 'Select date (optional)';

  // ── Campus / machine helpers ─────────────────────────────────────────────────
  const addCampus = () => setCampuses(prev => [...prev, newCampus()]);
  const removeCampus = (ci: number) => setCampuses(prev => prev.filter((_, i) => i !== ci));

  const updateCampus = (ci: number, patch: Partial<CampusEntry>) =>
    setCampuses(prev => prev.map((c, i) => i === ci ? { ...c, ...patch } : c));

  const addMachine = (ci: number) =>
    setCampuses(prev => prev.map((c, i) => i === ci ? { ...c, machines: [...c.machines, newMachine()] } : c));

  const removeMachine = (ci: number, mi: number) =>
    setCampuses(prev => prev.map((c, i) => i === ci
      ? { ...c, machines: c.machines.filter((_, j) => j !== mi) }
      : c));

  const updateMachine = (ci: number, mi: number, patch: Partial<MachineEntry>) =>
    setCampuses(prev => prev.map((c, i) => i === ci
      ? { ...c, machines: c.machines.map((m, j) => j === mi ? { ...m, ...patch } : m) }
      : c));

  // ── Computed totals ──────────────────────────────────────────────────────────
  const totalBwPages = campuses.reduce((sum, c) =>
    sum + c.machines.reduce((ms, m) => {
      const s = parseInt(m.counterBwStart, 10);
      const e = parseInt(m.counterBwEnd, 10);
      return ms + (!isNaN(s) && !isNaN(e) && e >= s ? e - s : 0);
    }, 0), 0);

  const priceNum = parseFloat(pricePerPage);
  const rateNum  = parseInt(rateUsed, 10);
  const totalUsd = !isNaN(priceNum) && priceNum > 0 ? totalBwPages * priceNum : 0;
  const totalKhr = !isNaN(rateNum)  && rateNum  > 0 ? totalUsd * rateNum      : 0;

  const validMachineCount = campuses.reduce((sum, c) =>
    sum + c.machines.filter(m => m.contractRef.trim().length > 0).length, 0);

  // ── Validation ───────────────────────────────────────────────────────────────
  const isFormReady = (() => {
    if (rateUsed && (isNaN(parseInt(rateUsed, 10)) || parseInt(rateUsed, 10) <= 0)) return false;
    return campuses.every(c => {
      if (!c.campusCode) return false;
      return c.machines.every(m => {
        const s = parseInt(m.counterBwStart, 10);
        const e = parseInt(m.counterBwEnd, 10);
        return m.contractRef.trim().length > 0 && !isNaN(s) && s >= 0 && !isNaN(e) && e >= s;
      });
    });
  })();

  const validate = (): boolean => {
    let ok = true;
    const he: Record<string, string> = {};
    if (!issuedAt) {
      he.issuedAt = 'Select a period month';
      ok = false;
    }
    if (rateUsed && (isNaN(parseInt(rateUsed, 10)) || parseInt(rateUsed, 10) <= 0)) {
      he.rateUsed = 'Enter a valid exchange rate';
      ok = false;
    }
    setHeaderErrors(he);

    setCampuses(prev => prev.map(c => {
      let ce = '';
      if (!c.campusCode) { ce = 'Select a campus'; ok = false; }
      const machines = c.machines.map(m => {
        const e: Record<string, string> = {};
        if (!m.contractRef.trim()) { e.contractRef = 'Required'; ok = false; }
        const s = parseInt(m.counterBwStart, 10);
        const ev = parseInt(m.counterBwEnd, 10);
        if (isNaN(s) || s < 0) { e.counterBwStart = 'Required'; ok = false; }
        if (isNaN(ev) || ev < 0) { e.counterBwEnd = 'Required'; ok = false; }
        if (!isNaN(s) && !isNaN(ev) && ev < s) { e.counterBwEnd = 'End must be ≥ start'; ok = false; }
        return { ...m, errors: e };
      });
      return { ...c, campusError: ce, machines };
    }));
    return ok;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    setConfirmError(null);
    setShowConfirm(true);
  };

  const doSubmit = async () => {
    setSubmitting(true);
    setConfirmError(null);
    try {
      const payload: RentalCampusInput[] = campuses.map(c => ({
        campusId:   c.campusId ?? undefined,
        campusCode: c.campusCode,
        machines: c.machines.map(m => ({
          contractRef:    m.contractRef.trim(),
          counterBwStart: parseInt(m.counterBwStart, 10),
          counterBwEnd:   parseInt(m.counterBwEnd, 10),
          amountCents:    m.amountUsd ? Math.round(parseFloat(m.amountUsd) * 100) : null,
        })),
      }));

      const result = await createRentalInvoiceApi({
        periodMonth: `${issuedAt.substring(0, 7)}-01`,
        rateUsed:    rateUsed ? parseInt(rateUsed, 10) : null,
        startDate:   startDate || null,
        endDate:     endDate   || null,
        dueAt:       dueAt     || null,
        note:        note.trim() || null,
        campuses:    payload,
      });
      setShowConfirm(false);
      showAlert({
        type: 'success',
        title: 'Invoice Created',
        message: `Rental invoice ${result.invoiceNumber ?? ''} created successfully.`,
        actions: [{ label: 'OK', variant: 'primary', onPress: onSaved }],
        icon: 'receipt-long',
      });
    } catch (err: any) {
      const body  = err?.response?.data;
      const raw: string | undefined =
        body?.error?.messageKey ?? body?.error?.code ??
        body?.message ?? err?.message;
      const fields = body?.error?.fields;
      const fieldsDetail = fields && typeof fields === 'object'
        ? Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(', ')
        : undefined;
      const detail: string | undefined =
        fieldsDetail ??
        body?.error?.detail ?? body?.error?.field ??
        body?.error?.message ?? body?.errors?.[0]?.message;
      setConfirmError({ raw: raw ?? 'unknown', detail });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.safe}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <AppBar
        title="Rental Invoice"
        subtitle="Create invoice from rental contracts"
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      {/* Hero strip */}
      <View style={styles.hero}>
        <View style={styles.heroStat}>
          <AppText style={styles.heroStatLabel}>ISSUED</AppText>
          <AppText style={styles.heroStatValue} numberOfLines={1}>
            {issuedAt ? formatDateLabel(issuedAt) : '—'}
          </AppText>
        </View>
        <View style={styles.heroSep} />
        <View style={styles.heroStat}>
          <AppText style={styles.heroStatLabel}>CAMPUSES</AppText>
          <AppText style={styles.heroStatValue}>{campuses.length}</AppText>
        </View>
        <View style={styles.heroSep} />
        <View style={styles.heroStat}>
          <AppText style={styles.heroStatLabel}>BW PAGES</AppText>
          <AppText style={styles.heroStatValue}>
            {totalBwPages > 0 ? totalBwPages.toLocaleString() : '—'}
          </AppText>
        </View>
        <View style={styles.heroSep} />
        <View style={styles.heroStat}>
          <AppText style={styles.heroStatLabel}>AMOUNT</AppText>
          <AppText style={styles.heroStatValue}>
            {totalUsd > 0 ? `$${totalUsd.toFixed(2)}` : '—'}
          </AppText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Invoice Details card ── */}
        <View style={styles.card}>
          <View style={styles.cardAccent} />
          <View style={styles.cardInner}>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.sectionDot, { backgroundColor: Colors.primary }]} />
              <AppText style={styles.sectionTitle}>Invoice Details</AppText>
            </View>

            {/* Period Month (required) */}
            <AppText style={styles.fieldLabel}>Period Month</AppText>
            <TouchableOpacity
              style={[styles.dateBtn, issuedAt ? styles.dateBtnFilled : null, headerErrors.issuedAt ? styles.dateBtnError : null]}
              onPress={() => openDatePicker('issuedAt')}
            >
              <View style={[styles.dateBtnIcon, issuedAt ? styles.dateBtnIconFilled : null]}>
                <Icon name="calendar-month" size={16} color={issuedAt ? Colors.white : Colors.textSecondary} />
              </View>
              <AppText style={[styles.dateBtnText, !issuedAt && styles.datePlaceholder]}>
                {issuedAtLabel}
              </AppText>
              {issuedAt
                ? <TouchableOpacity onPress={() => setIssuedAt('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Icon name="cancel" size={18} color={Colors.textLight} />
                  </TouchableOpacity>
                : <Icon name="expand-more" size={20} color={Colors.textSecondary} />}
            </TouchableOpacity>
            {headerErrors.issuedAt ? <AppText style={styles.fieldError}>{headerErrors.issuedAt}</AppText> : null}

            {/* Due Date */}
            <AppText style={[styles.fieldLabel, { marginTop: 12 }]}>
              Due Date <AppText style={styles.optional}>(optional)</AppText>
            </AppText>
            <TouchableOpacity
              style={[styles.dateBtn, dueAt ? styles.dateBtnFilled : null]}
              onPress={() => openDatePicker('dueAt')}
            >
              <View style={[styles.dateBtnIcon, dueAt ? styles.dateBtnIconFilled : null]}>
                <Icon name="event-available" size={16} color={dueAt ? Colors.white : Colors.textSecondary} />
              </View>
              <AppText style={[styles.dateBtnText, !dueAt && styles.datePlaceholder]}>
                {dueAtLabel}
              </AppText>
              {dueAt
                ? <TouchableOpacity onPress={() => setDueAt('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Icon name="cancel" size={18} color={Colors.textLight} />
                  </TouchableOpacity>
                : <Icon name="expand-more" size={20} color={Colors.textSecondary} />}
            </TouchableOpacity>

            {/* Start Date / End Date */}
            <View style={styles.campusDateRow}>
              <View style={styles.campusDateCol}>
                <AppText style={[styles.fieldLabel, { marginTop: 12 }]}>
                  Start Date <AppText style={styles.optional}>(optional)</AppText>
                </AppText>
                <TouchableOpacity
                  style={[styles.dateBtn, startDate ? styles.dateBtnFilled : null]}
                  onPress={() => openDatePicker('startDate')}
                >
                  <View style={[styles.dateBtnIcon, startDate ? styles.dateBtnIconFilled : null]}>
                    <Icon name="calendar-today" size={16} color={startDate ? Colors.white : Colors.textSecondary} />
                  </View>
                  <AppText style={[styles.dateBtnText, !startDate && styles.datePlaceholder]}>
                    {startDate ? formatDateLabel(startDate) : 'Select'}
                  </AppText>
                  {startDate
                    ? <TouchableOpacity onPress={() => setStartDate('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Icon name="cancel" size={18} color={Colors.textLight} />
                      </TouchableOpacity>
                    : <Icon name="expand-more" size={20} color={Colors.textSecondary} />}
                </TouchableOpacity>
              </View>
              <View style={styles.campusDateCol}>
                <AppText style={[styles.fieldLabel, { marginTop: 12 }]}>
                  End Date <AppText style={styles.optional}>(optional)</AppText>
                </AppText>
                <TouchableOpacity
                  style={[styles.dateBtn, endDate ? styles.dateBtnFilled : null]}
                  onPress={() => openDatePicker('endDate')}
                >
                  <View style={[styles.dateBtnIcon, endDate ? styles.dateBtnIconFilled : null]}>
                    <Icon name="event" size={16} color={endDate ? Colors.white : Colors.textSecondary} />
                  </View>
                  <AppText style={[styles.dateBtnText, !endDate && styles.datePlaceholder]}>
                    {endDate ? formatDateLabel(endDate) : 'Select'}
                  </AppText>
                  {endDate
                    ? <TouchableOpacity onPress={() => setEndDate('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Icon name="cancel" size={18} color={Colors.textLight} />
                      </TouchableOpacity>
                    : <Icon name="expand-more" size={20} color={Colors.textSecondary} />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Rate + Price */}
            <View style={[styles.rateRow, { marginTop: 12 }]}>
              <View style={styles.rateHalf}>
                <AppInput
                  label="Rate (KHR/USD) *"
                  value={rateUsed}
                  onChangeText={v => setRateUsed(v.replace(/[^0-9]/g, ''))}
                  placeholder="4100"
                  keyboardType="number-pad"
                  error={headerErrors.rateUsed}
                />
              </View>
              <View style={styles.rateHalf}>
                <AppInput
                  label="Price/Page (USD)"
                  value={pricePerPage}
                  onChangeText={v => setPricePerPage(v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00435"
                  keyboardType="decimal-pad"
                  hint="Preview only"
                />
              </View>
            </View>

            <AppInput
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. June 2026 printer rental"
              multiline
              numberOfLines={2}
            />
          </View>
        </View>

        {/* ── Campus cards ── */}
        {campuses.map((campus, ci) => {
          const accent   = CAMPUS_ACCENTS[ci % CAMPUS_ACCENTS.length];
          const accentBg = CAMPUS_ACCENT_BG[ci % CAMPUS_ACCENT_BG.length];

          const campusBwPages = campus.machines.reduce((sum, m) => {
            const s = parseInt(m.counterBwStart, 10);
            const e = parseInt(m.counterBwEnd, 10);
            return sum + (!isNaN(s) && !isNaN(e) && e >= s ? e - s : 0);
          }, 0);

          return (
            <View key={campus.key} style={[styles.campusCard, { borderLeftColor: accent }]}>
              {/* Campus header */}
              <View style={styles.campusCardHeader}>
                <View style={[styles.campusBadge, { backgroundColor: accentBg }]}>
                  <Icon name="location-city" size={13} color={accent} />
                  <AppText style={[styles.campusBadgeText, { color: accent }]}>
                    Campus {ci + 1}
                  </AppText>
                </View>
                {campusBwPages > 0 && (
                  <AppText style={[styles.campusPageCount, { color: accent }]}>
                    {campusBwPages.toLocaleString()} pages
                  </AppText>
                )}
                {campuses.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeCampus(ci)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="remove-circle-outline" size={20} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Campus picker button */}
              <AppText style={styles.fieldLabel}>
                Campus <AppText style={styles.required}>*</AppText>
              </AppText>
              <TouchableOpacity
                style={[styles.dateBtn,
                  campus.campusCode ? styles.dateBtnFilled : null,
                  campus.campusError ? styles.dateBtnError : null]}
                onPress={() => { setCampusPickerSearch(''); setCampusPickerIdx(ci); }}
              >
                <View style={[styles.dateBtnIcon, campus.campusCode ? { backgroundColor: accent } : null]}>
                  <Icon name="location-city" size={16}
                    color={campus.campusCode ? Colors.white : Colors.textSecondary} />
                </View>
                <AppText style={[styles.dateBtnText, !campus.campusCode && styles.datePlaceholder]}>
                  {campus.campusCode
                    ? `${campus.campusName} (${campus.campusCode})`
                    : contractsLoading ? 'Loading campuses…' : 'Select campus'}
                </AppText>
                <Icon name="expand-more" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
              {campus.campusError
                ? <AppText style={styles.fieldError}>{campus.campusError}</AppText>
                : null}

              {/* Machine entries */}
              {campus.machines.map((machine, mi) => {
                const s  = parseInt(machine.counterBwStart, 10);
                const e  = parseInt(machine.counterBwEnd, 10);
                const pg = !isNaN(s) && !isNaN(e) && e >= s ? e - s : null;
                const costUsd = pg !== null && !isNaN(priceNum) && priceNum > 0 ? pg * priceNum : null;
                const amtUsd = machine.amountUsd ? parseFloat(machine.amountUsd) : null;

                return (
                  <View key={machine.key} style={styles.machineCard}>
                    <View style={styles.machineCardHeader}>
                      <View style={[styles.machineNumCircle, { backgroundColor: accentBg }]}>
                        <AppText style={[styles.machineNumText, { color: accent }]}>{mi + 1}</AppText>
                      </View>
                      <AppText style={styles.machineCardTitle}>Machine {mi + 1}</AppText>
                      {campus.machines.length > 1 && (
                        <TouchableOpacity
                          onPress={() => removeMachine(ci, mi)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Icon name="close" size={18} color={Colors.textLight} />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Contract Ref — direct input + picker button */}
                    <AppText style={styles.fieldLabel}>
                      Contract Ref <AppText style={styles.required}>*</AppText>
                    </AppText>
                    <View style={styles.contractRefRow}>
                      <View style={{ flex: 1 }}>
                        <AppInput
                          value={machine.contractRef}
                          onChangeText={v => updateMachine(ci, mi, { contractRef: v, errors: {} })}
                          placeholder={campus.campusCode ? 'Type or select contract ref' : 'Select campus first'}
                          autoCapitalize="characters"
                          error={machine.errors.contractRef}
                          editable={!!campus.campusCode}
                        />
                      </View>
                      <TouchableOpacity
                        style={[styles.contractPickerBtn, !campus.campusCode && styles.dateBtnDisabled]}
                        onPress={() => {
                          if (!campus.campusCode) return;
                          setContractPickerSearch(machine.contractRef);
                          setContractPicker({ campusIdx: ci, machineIdx: mi });
                        }}
                      >
                        <Icon name="search" size={20} color={campus.campusCode ? Colors.primary : Colors.textLight} />
                      </TouchableOpacity>
                    </View>

                    {/* Counter inputs */}
                    {(() => {
                      const lastCounter = machine.contractRef.trim()
                        ? getLastCounter(campus.campusCode, machine.contractRef.trim())
                        : '';
                      const lastInv = machine.contractRef.trim()
                        ? allRentalInvoices.find(inv => {
                            const lines: any[] = (inv as any).lines ?? inv.details ?? [];
                            return lines.some(d =>
                              (d.campusCode ?? d.campus?.campusCode ?? '') === campus.campusCode &&
                              (d.lineLabel ?? d.contractRef ?? '') === machine.contractRef.trim() &&
                              d.counterBwEnd != null
                            );
                          })
                        : undefined;
                      const lastPeriod = lastInv?.periodMonth?.substring(0, 7) ?? '';
                      const isUsed = lastCounter !== '' && machine.counterBwStart === lastCounter;
                      const chipColor = isUsed ? '#16A34A' : '#2563EB';
                      const chipBg    = isUsed ? '#F0FDF4' : '#EFF6FF';
                      const chipBorder= isUsed ? '#BBF7D0' : '#BFDBFE';
                      return lastCounter ? (
                        <TouchableOpacity
                          style={[styles.lastCounterChip, { backgroundColor: chipBg, borderColor: chipBorder }]}
                          onPress={() => {
                            const s2 = parseInt(lastCounter, 10);
                            const e2 = parseInt(machine.counterBwEnd, 10);
                            const pages2 = !isNaN(s2) && !isNaN(e2) && e2 >= s2 ? e2 - s2 : null;
                            const auto = pages2 !== null && priceNum > 0
                              ? (pages2 * priceNum).toFixed(2) : '';
                            updateMachine(ci, mi, { counterBwStart: lastCounter, amountUsd: auto, errors: {} });
                          }}
                          activeOpacity={0.7}
                        >
                          <Icon name={isUsed ? 'check-circle' : 'history'} size={13} color={chipColor} />
                          <AppText style={[styles.lastCounterText, { color: chipColor }]}>
                            Last end: {Number(lastCounter).toLocaleString()}{lastPeriod ? ` (${lastPeriod})` : ''} · {isUsed ? 'applied as BW Start' : 'tap to use as BW Start'}
                          </AppText>
                        </TouchableOpacity>
                      ) : null;
                    })()}
                    <View style={styles.counterRow}>
                      <View style={styles.counterHalf}>
                        <AppInput
                          label="BW Counter Start *"
                          value={machine.counterBwStart}
                          onChangeText={v => {
                            const start = v.replace(/[^0-9]/g, '');
                            const s2 = parseInt(start, 10);
                            const e2 = parseInt(machine.counterBwEnd, 10);
                            const pages2 = !isNaN(s2) && !isNaN(e2) && e2 >= s2 ? e2 - s2 : null;
                            const auto = pages2 !== null && priceNum > 0
                              ? (pages2 * priceNum).toFixed(2) : '';
                            updateMachine(ci, mi, { counterBwStart: start, amountUsd: auto, errors: {} });
                          }}
                          placeholder={machine.contractRef.trim() ? getLastCounter(campus.campusCode, machine.contractRef.trim()) || 'e.g. 12500' : 'e.g. 12500'}
                          keyboardType="number-pad"
                          error={machine.errors.counterBwStart}
                        />
                      </View>
                      <View style={styles.counterHalf}>
                        <AppInput
                          label="BW Counter End *"
                          value={machine.counterBwEnd}
                          onChangeText={v => {
                            const end = v.replace(/[^0-9]/g, '');
                            const s2 = parseInt(machine.counterBwStart, 10);
                            const e2 = parseInt(end, 10);
                            const pages2 = !isNaN(s2) && !isNaN(e2) && e2 >= s2 ? e2 - s2 : null;
                            const auto = pages2 !== null && priceNum > 0
                              ? (pages2 * priceNum).toFixed(2) : '';
                            updateMachine(ci, mi, { counterBwEnd: end, amountUsd: auto, errors: {} });
                          }}
                          placeholder="e.g. 15200"
                          keyboardType="number-pad"
                          error={machine.errors.counterBwEnd}
                        />
                      </View>
                    </View>

                    <AppInput
                      label="Amount (USD, optional)"
                      value={machine.amountUsd}
                      onChangeText={v => updateMachine(ci, mi, {
                        amountUsd: v.replace(/[^0-9.]/g, ''), errors: {},
                      })}
                      placeholder="Auto-calculated (e.g. 11.75)"
                      keyboardType="decimal-pad"
                    />

                    {/* Usage chip */}
                    {pg !== null && (
                      <View style={[styles.usageChip, { backgroundColor: accentBg }]}>
                        <Icon name="receipt-long" size={13} color={accent} />
                        <AppText style={[styles.usageText, { color: accent }]}>
                          {pg.toLocaleString()} pages
                        </AppText>
                        {amtUsd !== null && amtUsd > 0 && (
                          <>
                            <View style={[styles.usageSep, { backgroundColor: accent + '40' }]} />
                            <AppText style={[styles.usageCost, { color: accent }]}>
                              ${amtUsd.toFixed(2)}
                            </AppText>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}

              {/* Add machine button */}
              <TouchableOpacity style={styles.addMachineBtn} onPress={() => addMachine(ci)}>
                <Icon name="add-circle" size={18} color="#16A34A" />
                <AppText style={styles.addMachineBtnText}>Add Machine</AppText>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Add campus */}
        <TouchableOpacity style={styles.addCampusBtn} onPress={addCampus}>
          <Icon name="add-circle" size={20} color="#EA580C" />
          <AppText style={styles.addCampusBtnText}>Add Another Campus</AppText>
        </TouchableOpacity>

        {/* Grand total */}
        {totalBwPages > 0 && (
          <View style={styles.totalCard}>
            <View style={styles.totalCardAccent} />
            <View style={styles.totalInner}>
              <View style={styles.totalMainRow}>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.totalMainLabel}>Total Amount</AppText>
                  <AppText style={styles.totalMainValue}>${totalUsd.toFixed(2)}</AppText>
                  {totalKhr > 0 && (
                    <AppText style={styles.totalKhrValue}>≈ ៛{Math.round(totalKhr).toLocaleString()}</AppText>
                  )}
                </View>
                <View style={styles.totalBadge}>
                  <Icon name="attach-money" size={22} color={Colors.primary} />
                </View>
              </View>
              <View style={styles.totalDivider} />
              <View style={styles.totalMetaRow}>
                <View style={styles.totalMetaItem}>
                  <AppText style={styles.totalMetaLabel}>BW Pages</AppText>
                  <AppText style={styles.totalMetaValue}>{totalBwPages.toLocaleString()}</AppText>
                </View>
                <View style={styles.totalMetaSep} />
                <View style={styles.totalMetaItem}>
                  <AppText style={styles.totalMetaLabel}>Machines</AppText>
                  <AppText style={styles.totalMetaValue}>{validMachineCount}</AppText>
                </View>
                <View style={styles.totalMetaSep} />
                <View style={styles.totalMetaItem}>
                  <AppText style={styles.totalMetaLabel}>Campuses</AppText>
                  <AppText style={styles.totalMetaValue}>{campuses.length}</AppText>
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Sticky submit panel */}
      <View style={styles.submitPanel}>
        {totalBwPages > 0 && (
          <View style={styles.submitPreview}>
            <Icon name="info-outline" size={14} color={Colors.primary} />
            <AppText style={styles.submitPreviewText}>
              {validMachineCount} machine{validMachineCount !== 1 ? 's' : ''} · {campuses.length} campus{campuses.length !== 1 ? 'es' : ''} · {totalBwPages.toLocaleString()} pages{totalUsd > 0 ? ` · $${totalUsd.toFixed(2)}` : ''}
            </AppText>
          </View>
        )}
        <AppButton
          label="Create Rental Invoice"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!isFormReady}
          fullWidth
          size="lg"
        />
      </View>

      {/* ── Date picker modal ── */}
      <Modal visible={pickerTarget !== null} transparent animationType="fade" onRequestClose={() => setPickerTarget(null)}>
        <View style={styles.dpBackdropWrap}>
          <TouchableOpacity style={styles.dpBackdrop} activeOpacity={1} onPress={() => setPickerTarget(null)} />
          <View style={styles.dpSheet}>
            <View style={styles.dpHandle} />
            <View style={styles.dpToolbar}>
              <TouchableOpacity onPress={() => setPickerTarget(null)}>
                <AppText style={styles.dpCancel}>Cancel</AppText>
              </TouchableOpacity>
              <AppText style={styles.dpTitle}>
                {pickerTarget === 'issuedAt' ? 'Select Period Month'
  : pickerTarget === 'dueAt' ? 'Select Due Date'
  : pickerTarget === 'startDate' ? 'Select Start Date'
  : 'Select End Date'}
              </AppText>
              <TouchableOpacity onPress={confirmDatePicker} style={styles.dpDoneBtn}>
                <AppText style={styles.dpDone}>Done</AppText>
              </TouchableOpacity>
            </View>
            <View style={styles.dpColumns}>
              <View style={styles.dpColWrap}>
                <View pointerEvents="none" style={styles.dpHighlight} />
                <ScrollView ref={dpYearRef} showsVerticalScrollIndicator={false} snapToInterval={DP_ITEM_H} decelerationRate="fast" contentContainerStyle={styles.dpColContent}
                  onMomentumScrollEnd={e => { const i = Math.round(e.nativeEvent.contentOffset.y / DP_ITEM_H); setDpYear(DP_YEARS[Math.max(0, Math.min(i, DP_YEARS.length - 1))]); }}>
                  {DP_YEARS.map(y => (
                    <TouchableOpacity key={y} style={styles.dpItem} onPress={() => { dpYearRef.current?.scrollTo({ y: DP_YEARS.indexOf(y) * DP_ITEM_H, animated: true }); setDpYear(y); }}>
                      <AppText style={[styles.dpItemText, dpYear === y && styles.dpItemSelected]}>{y}</AppText>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.dpColWrap}>
                <View pointerEvents="none" style={styles.dpHighlight} />
                <ScrollView ref={dpMonthRef} showsVerticalScrollIndicator={false} snapToInterval={DP_ITEM_H} decelerationRate="fast" contentContainerStyle={styles.dpColContent}
                  onMomentumScrollEnd={e => { const i = Math.round(e.nativeEvent.contentOffset.y / DP_ITEM_H); setDpMonth(Math.max(1, Math.min(i + 1, 12))); }}>
                  {DP_MONTHS.map((mn, i) => (
                    <TouchableOpacity key={mn} style={styles.dpItem} onPress={() => { dpMonthRef.current?.scrollTo({ y: i * DP_ITEM_H, animated: true }); setDpMonth(i + 1); }}>
                      <AppText style={[styles.dpItemText, dpMonth === i + 1 && styles.dpItemSelected]}>{mn}</AppText>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {(pickerTarget === 'dueAt' || pickerTarget === 'startDate' || pickerTarget === 'endDate') && (
                <View style={styles.dpColWrap}>
                  <View pointerEvents="none" style={styles.dpHighlight} />
                  <ScrollView ref={dpDayRef} showsVerticalScrollIndicator={false} snapToInterval={DP_ITEM_H} decelerationRate="fast" contentContainerStyle={styles.dpColContent}
                    onMomentumScrollEnd={e => { const i = Math.round(e.nativeEvent.contentOffset.y / DP_ITEM_H); setDpDay(Math.max(1, Math.min(i + 1, getDaysInMonth(dpYear, dpMonth)))); }}>
                    {Array.from({ length: getDaysInMonth(dpYear, dpMonth) }, (_, i) => i + 1).map(d => (
                      <TouchableOpacity key={d} style={styles.dpItem} onPress={() => { dpDayRef.current?.scrollTo({ y: (d - 1) * DP_ITEM_H, animated: true }); setDpDay(d); }}>
                        <AppText style={[styles.dpItemText, dpDay === d && styles.dpItemSelected]}>{String(d).padStart(2, '0')}</AppText>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Campus picker modal ── */}
      <Modal visible={campusPickerIdx !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCampusPickerIdx(null)}>
        <View style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <View>
              <AppText style={styles.modalTitle}>Select Campus</AppText>
              <AppText style={styles.modalSubtitle}>{availableCampuses.length} campuses available</AppText>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setCampusPickerIdx(null)}>
              <Icon name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <AppInput
            placeholder="Search campus…"
            value={campusPickerSearch}
            onChangeText={setCampusPickerSearch}
            containerStyle={styles.modalSearch}
            leftIcon={<Icon name="search" size={20} color={Colors.textSecondary} />}
          />
          {contractsLoading
            ? <View style={styles.modalLoading}><ActivityIndicator color={Colors.primary} /><AppText style={styles.modalLoadingText}>Loading…</AppText></View>
            : contractsError
            ? (
              <View style={styles.modalLoading}>
                <Icon name="error-outline" size={40} color={Colors.textLight} />
                <AppText style={{ color: Colors.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 24 }}>{contractsError}</AppText>
                <TouchableOpacity onPress={loadContracts} style={styles.retryBtn}>
                  <Icon name="refresh" size={16} color={Colors.primary} />
                  <AppText style={styles.retryBtnText}>Retry</AppText>
                </TouchableOpacity>
              </View>
            )
            : (
              <FlatList
                data={availableCampuses.filter(c => {
                  const q = campusPickerSearch.trim().toLowerCase();
                  return !q || c.campusName.toLowerCase().includes(q) || c.campusCode.toLowerCase().includes(q);
                })}
                keyExtractor={item => item.campusCode}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 40 }}
                renderItem={({ item, index }) => {
                  const accent   = CAMPUS_ACCENTS[index % CAMPUS_ACCENTS.length];
                  const accentBg = CAMPUS_ACCENT_BG[index % CAMPUS_ACCENT_BG.length];
                  const isSelected = campusPickerIdx !== null && campuses[campusPickerIdx]?.campusCode === item.campusCode;
                  return (
                    <TouchableOpacity
                      style={[styles.pickerRow, isSelected && { backgroundColor: accentBg }]}
                      onPress={() => {
                        if (campusPickerIdx !== null) {
                          updateCampus(campusPickerIdx, {
                            campusId:   item.campusId,
                            campusName: item.campusName,
                            campusCode: item.campusCode,
                            campusError: '',
                            machines: [newMachine()],
                          });
                        }
                        setCampusPickerIdx(null);
                      }}
                    >
                      <View style={[styles.pickerRowIcon, { backgroundColor: accentBg }]}>
                        <Icon name="location-city" size={18} color={accent} />
                      </View>
                      <View style={styles.pickerRowInfo}>
                        <AppText style={styles.pickerRowTitle}>{item.campusName}</AppText>
                        <AppText style={styles.pickerRowSub}>{item.campusCode}</AppText>
                      </View>
                      {isSelected && <Icon name="check-circle" size={20} color={accent} />}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.pickerEmpty}>
                    <Icon name="location-off" size={40} color={Colors.textLight} />
                    <AppText style={{ color: Colors.textSecondary, marginTop: 8 }}>No campuses found</AppText>
                  </View>
                }
              />
            )}
        </View>
      </Modal>

      {/* ── Contract picker modal ── */}
      <Modal visible={contractPicker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setContractPicker(null)}>
        <View style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <View>
              <AppText style={styles.modalTitle}>Select Contract</AppText>
              <AppText style={styles.modalSubtitle}>
                {contractPicker !== null ? campuses[contractPicker.campusIdx]?.campusName : ''} · {contractsForPicker.length} contract{contractsForPicker.length !== 1 ? 's' : ''}
              </AppText>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setContractPicker(null)}>
              <Icon name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <AppInput
            placeholder="Search contract…"
            value={contractPickerSearch}
            onChangeText={setContractPickerSearch}
            containerStyle={styles.modalSearch}
            leftIcon={<Icon name="search" size={20} color={Colors.textSecondary} />}
          />
          <FlatList
            data={contractsForPicker}
            keyExtractor={item => String(item.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={
              contractPickerSearch.trim().length > 0 ? (
                <TouchableOpacity
                  style={styles.addManualRow}
                  onPress={() => {
                    if (contractPicker !== null) {
                      const ref = contractPickerSearch.trim();
                      const campusCode = campuses[contractPicker.campusIdx]?.campusCode ?? '';
                      const lastCounter = getLastCounter(campusCode, ref);
                      updateMachine(contractPicker.campusIdx, contractPicker.machineIdx, {
                        contractRef: ref,
                        ...(lastCounter ? { counterBwStart: lastCounter } : {}),
                        errors: {},
                      });
                    }
                    setContractPicker(null);
                  }}
                >
                  <View style={styles.addManualIcon}>
                    <Icon name="add-circle" size={20} color={Colors.primary} />
                  </View>
                  <View style={styles.pickerRowInfo}>
                    <AppText style={styles.addManualTitle}>Use "{contractPickerSearch.trim()}"</AppText>
                    <AppText style={styles.addManualSub}>Add as manual contract reference</AppText>
                  </View>
                  <Icon name="chevron-right" size={20} color={Colors.primary} />
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item }) => {
              const isSelected = contractPicker !== null &&
                campuses[contractPicker.campusIdx]?.machines[contractPicker.machineIdx]?.contractRef === item.referenceNumber;
              return (
                <TouchableOpacity
                  style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                  onPress={() => {
                    if (contractPicker !== null) {
                      const campusCode = campuses[contractPicker.campusIdx]?.campusCode ?? '';
                      const lastCounter = getLastCounter(campusCode, item.referenceNumber);
                      updateMachine(contractPicker.campusIdx, contractPicker.machineIdx, {
                        contractRef: item.referenceNumber,
                        ...(lastCounter ? { counterBwStart: lastCounter } : {}),
                        errors: {},
                      });
                    }
                    setContractPicker(null);
                  }}
                >
                  <View style={styles.pickerRowIcon}>
                    <Icon name="print" size={18} color={Colors.primary} />
                  </View>
                  <View style={styles.pickerRowInfo}>
                    <AppText style={styles.pickerRowTitle}>{item.referenceNumber}</AppText>
                    {(item.assetBrand || item.assetModel) && (
                      <AppText style={styles.pickerRowSub}>
                        {[item.assetBrand, item.assetModel].filter(Boolean).join(' ')}
                      </AppText>
                    )}
                  </View>
                  <View style={[styles.pickerStatusBadge, isSelected && { backgroundColor: Colors.primaryMuted }]}>
                    <AppText style={[styles.pickerStatusText, isSelected && { color: Colors.primary }]}>
                      {item.status}
                    </AppText>
                  </View>
                  {isSelected && <Icon name="check-circle" size={20} color={Colors.primary} />}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.pickerEmpty}>
                <Icon name="print-disabled" size={40} color={Colors.textLight} />
                <AppText style={{ color: Colors.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>
                  No contracts found for this campus
                </AppText>
                <AppText style={{ color: Colors.textLight, marginTop: 4, textAlign: 'center', paddingHorizontal: 32, fontSize: 12 }}>
                  Type a contract reference above to add it manually
                </AppText>
              </View>
            }
          />
        </View>
      </Modal>

      {/* ── Confirm modal ── */}
      <Modal visible={showConfirm} transparent animationType="fade" onRequestClose={() => { if (!submitting) { setShowConfirm(false); setConfirmError(null); } }}>
        <View style={styles.cfBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1}
            onPress={() => { if (!submitting) { setShowConfirm(false); setConfirmError(null); } }} />
          <View style={styles.cfSheet}>
            {/* Lottie + close */}
            <View style={styles.cfLottieRow}>
              <LottieView
                source={require('../../assets/animations/invoice-confirm.json')}
                autoPlay
                loop={false}
                style={styles.cfLottie}
              />
              <TouchableOpacity
                onPress={() => { if (!submitting) { setShowConfirm(false); setConfirmError(null); } }}
                style={styles.cfCloseBtn}
              >
                <Icon name="close" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.cfHeader}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.cfTitle}>Confirm Invoice</AppText>
                <AppText style={styles.cfSubtitle}>Please review before creating</AppText>
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.cfScroll}>
              {/* Header details */}
              <View style={styles.cfCard}>
                {issuedAt ? (
                  <View style={styles.cfRow}>
                    <Icon name="calendar-month" size={15} color={Colors.primary} />
                    <AppText style={styles.cfRowLabel}>Issued</AppText>
                    <AppText style={styles.cfRowValue}>{issuedAtLabel}</AppText>
                  </View>
                ) : null}
                {dueAt ? (
                  <View style={styles.cfRow}>
                    <Icon name="event" size={15} color={Colors.textSecondary} />
                    <AppText style={styles.cfRowLabel}>Due Date</AppText>
                    <AppText style={styles.cfRowValue}>{dueAtLabel}</AppText>
                  </View>
                ) : null}
                {startDate ? (
                  <View style={styles.cfRow}>
                    <Icon name="play-circle-outline" size={15} color={Colors.textSecondary} />
                    <AppText style={styles.cfRowLabel}>Start Date</AppText>
                    <AppText style={styles.cfRowValue}>{formatDateLabel(startDate)}</AppText>
                  </View>
                ) : null}
                {endDate ? (
                  <View style={styles.cfRow}>
                    <Icon name="stop-circle" size={15} color={Colors.textSecondary} />
                    <AppText style={styles.cfRowLabel}>End Date</AppText>
                    <AppText style={styles.cfRowValue}>{formatDateLabel(endDate)}</AppText>
                  </View>
                ) : null}
                <View style={styles.cfRow}>
                  <Icon name="currency-exchange" size={15} color={Colors.textSecondary} />
                  <AppText style={styles.cfRowLabel}>Rate</AppText>
                  <AppText style={styles.cfRowValue}>{parseInt(rateUsed, 10).toLocaleString()} KHR/USD</AppText>
                </View>
              </View>

              {/* Campus breakdown */}
              {campuses.map((c, ci) => {
                const accent   = CAMPUS_ACCENTS[ci % CAMPUS_ACCENTS.length];
                const accentBg = CAMPUS_ACCENT_BG[ci % CAMPUS_ACCENT_BG.length];
                return (
                  <View key={c.key} style={[styles.cfCampusCard, { borderLeftColor: accent }]}>
                    <View style={[styles.cfCampusBadge, { backgroundColor: accentBg }]}>
                      <Icon name="location-city" size={12} color={accent} />
                      <AppText style={[styles.cfCampusBadgeText, { color: accent }]}>{c.campusName}</AppText>
                    </View>
                    {c.machines.map((m, mi) => {
                      const s  = parseInt(m.counterBwStart, 10);
                      const ev = parseInt(m.counterBwEnd, 10);
                      const pg = !isNaN(s) && !isNaN(ev) && ev >= s ? ev - s : null;
                      return (
                        <View key={m.key} style={styles.cfMachineRow}>
                          <View style={[styles.cfMachineNum, { backgroundColor: accentBg }]}>
                            <AppText style={[styles.cfMachineNumText, { color: accent }]}>{mi + 1}</AppText>
                          </View>
                          <AppText style={styles.cfMachineId}>{m.contractRef}</AppText>
                          <AppText style={styles.cfMachineCounter}>{m.counterBwStart} → {m.counterBwEnd}</AppText>
                          {pg !== null && (
                            <AppText style={[styles.cfMachinePages, { color: accent }]}>{pg.toLocaleString()}p</AppText>
                          )}
                          {m.amountUsd ? (
                            <AppText style={[styles.cfMachinePages, { color: accent }]}>${parseFloat(m.amountUsd).toFixed(2)}</AppText>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                );
              })}

              {/* Totals */}
              {(() => {
                const sumUsd = campuses.reduce((s, c) =>
                  s + c.machines.reduce((ms, m) => ms + (m.amountUsd ? parseFloat(m.amountUsd) : 0), 0), 0);
                const sumKhr = !isNaN(rateNum) && rateNum > 0 ? sumUsd * rateNum : 0;
                return (
              <View style={styles.cfTotalCard}>
                <View style={styles.cfTotalRow}>
                  <AppText style={styles.cfTotalLabel}>Total (USD)</AppText>
                  <AppText style={styles.cfTotalValue}>${sumUsd.toFixed(2)}</AppText>
                </View>
                {sumKhr > 0 && (
                  <>
                    <View style={styles.cfTotalDivider} />
                    <View style={styles.cfTotalRow}>
                      <AppText style={styles.cfTotalLabel}>Total (KHR)</AppText>
                      <AppText style={styles.cfTotalValue}>៛{Math.round(sumKhr).toLocaleString()}</AppText>
                    </View>
                  </>
                )}
                <View style={styles.cfTotalDivider} />
                <View style={styles.cfTotalDivider} />
                <View style={styles.cfTotalRow}>
                  <AppText style={styles.cfTotalLabel}>BW Pages</AppText>
                  <AppText style={[styles.cfTotalValue, { fontSize: 14 }]}>{totalBwPages.toLocaleString()}</AppText>
                </View>
              </View>
                );
              })()}
            </ScrollView>

            {/* Error */}
            {confirmError ? (
              <View style={styles.cfErrorBox}>
                <Icon name="error" size={18} color={Colors.error} />
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText style={styles.cfErrorTitle}>Failed to Create Invoice</AppText>
                  <AppText style={styles.cfErrorMsg}>{translateApiError(confirmError.raw)}</AppText>
                  {confirmError.detail ? (
                    <AppText style={styles.cfErrorDetail}>Detail: {confirmError.detail}</AppText>
                  ) : null}
                  <AppText style={styles.cfErrorCode}>Code: {confirmError.raw}</AppText>
                </View>
                <TouchableOpacity onPress={() => setConfirmError(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={16} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.cfActions}>
              <TouchableOpacity
                style={[styles.cfCancelBtn, submitting && { opacity: 0.5 }]}
                disabled={submitting}
                onPress={() => { setShowConfirm(false); setConfirmError(null); }}
              >
                <AppText style={styles.cfCancelText}>Edit</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cfConfirmBtn, submitting && styles.cfConfirmBtnLoading]}
                disabled={submitting}
                onPress={doSubmit}
              >
                {submitting
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <>
                      <Icon name="check-circle" size={18} color={Colors.white} />
                      <AppText style={styles.cfConfirmText}>Create Invoice</AppText>
                    </>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F0F4F8' },
  scroll: { padding: 16, gap: 14, paddingBottom: 140 },

  hero:          { flexDirection: 'row', backgroundColor: Colors.primary, paddingVertical: 14, paddingHorizontal: 16 },
  heroStat:      { flex: 1, alignItems: 'center', gap: 3 },
  heroStatLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.65)', letterSpacing: 0.8 },
  heroStatValue: { fontSize: 14, fontWeight: '800', color: Colors.white },
  heroSep:       { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },

  card:       { backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  cardAccent: { height: 4, backgroundColor: Colors.primary },
  cardInner:  { padding: 16 },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionDot:      { width: 10, height: 10, borderRadius: 5 },
  sectionTitle:    { fontSize: 13, fontWeight: '700', color: Colors.text, textTransform: 'uppercase', letterSpacing: 0.6 },

  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  fieldError: { fontSize: 11, color: Colors.error, marginTop: 4, marginLeft: 2 },
  required:   { color: Colors.error },
  optional:   { fontSize: 11, color: Colors.textSecondary, fontWeight: '400' },

  dateBtn:          { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: Colors.surface },
  dateBtnFilled:    { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  dateBtnError:     { borderColor: Colors.error },
  dateBtnDisabled:  { opacity: 0.5 },
  dateBtnIcon:      { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  dateBtnIconFilled: { backgroundColor: Colors.primary },
  dateBtnText:      { flex: 1, fontSize: 15, color: Colors.text, fontWeight: '500' },
  datePlaceholder:  { color: Colors.textLight, fontWeight: '400' },

  rateRow:  { flexDirection: 'row', gap: 10 },
  rateHalf: { flex: 1 },

  campusCard:       { backgroundColor: Colors.surface, borderRadius: 16, borderLeftWidth: 4, padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  campusCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  campusBadge:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  campusBadgeText:  { fontSize: 12, fontWeight: '700' },
  campusPageCount:  { fontSize: 12, fontWeight: '600', flex: 1, textAlign: 'right' },

  campusDateRow:     { flexDirection: 'row', gap: 10, marginTop: 8 },
  campusDateCol:     { flex: 1 },
  machineCard:       { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.divider, gap: 4 },
  machineCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  machineNumCircle:  { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  machineNumText:    { fontSize: 11, fontWeight: '800' },
  machineCardTitle:  { fontSize: 13, fontWeight: '700', color: Colors.text, flex: 1 },

  counterRow:  { flexDirection: 'row', gap: 10 },
  counterHalf: { flex: 1 },
  lastCounterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    marginBottom: 8, borderWidth: 1, borderColor: '#BFDBFE',
  },
  lastCounterText: { fontSize: 12, color: '#2563EB', flex: 1 },

  usageChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', marginTop: 4 },
  usageText: { fontSize: 12, fontWeight: '700' },
  usageSep:  { width: 1, height: 14, borderRadius: 1 },
  usageCost: { fontSize: 12, fontWeight: '800' },

  addMachineBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#16A34A', backgroundColor: '#F0FDF4' },
  addMachineBtnText: { fontSize: 13, fontWeight: '700', color: '#16A34A' },

  addCampusBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#EA580C', backgroundColor: '#FFF7ED' },
  addCampusBtnText: { fontSize: 14, fontWeight: '700', color: '#EA580C' },

  totalCard:       { backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden', shadowColor: Colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3 },
  totalCardAccent: { height: 4, backgroundColor: Colors.primary },
  totalInner:      { padding: 16 },
  totalMainRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  totalMainLabel:  { fontSize: 11, color: Colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  totalMainValue:  { fontSize: 28, fontWeight: '900', color: Colors.primary },
  totalKhrValue:   { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginTop: 2 },
  totalBadge:      { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primaryMuted, alignItems: 'center', justifyContent: 'center' },
  totalDivider:    { height: 1, backgroundColor: Colors.divider, marginBottom: 12 },
  totalMetaRow:    { flexDirection: 'row', alignItems: 'center' },
  totalMetaItem:   { flex: 1, alignItems: 'center', gap: 2 },
  totalMetaSep:    { width: 1, height: 28, backgroundColor: Colors.divider },
  totalMetaLabel:  { fontSize: 10, color: Colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  totalMetaValue:  { fontSize: 16, fontWeight: '800', color: Colors.text },

  submitPanel:       { backgroundColor: Colors.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28, borderTopWidth: 1, borderTopColor: Colors.divider, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 8, gap: 10 },
  submitPreview:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primaryMuted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  submitPreviewText: { fontSize: 12, color: Colors.primary, fontWeight: '600', flex: 1 },

  dpBackdropWrap: { flex: 1, justifyContent: 'flex-end' },
  dpBackdrop:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  dpSheet:        { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  dpHandle:       { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.divider, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  dpToolbar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  dpCancel:       { fontSize: 15, color: Colors.textSecondary },
  dpTitle:        { fontSize: 16, fontWeight: '700', color: Colors.text },
  dpDoneBtn:      { backgroundColor: Colors.primaryMuted, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  dpDone:         { fontSize: 14, fontWeight: '700', color: Colors.primary },
  dpColumns:      { flexDirection: 'row', height: 220, marginTop: 4 },
  dpColWrap:      { flex: 1, position: 'relative' },
  dpHighlight:    { position: 'absolute', top: 88, left: 8, right: 8, height: DP_ITEM_H, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border, borderRadius: 8 },
  dpColContent:   { paddingVertical: DP_ITEM_H * 2 },
  dpItem:         { height: DP_ITEM_H, justifyContent: 'center', alignItems: 'center' },
  dpItemText:     { fontSize: 17, color: Colors.textSecondary, fontWeight: '400' },
  dpItemSelected: { color: Colors.text, fontWeight: '800', fontSize: 18 },

  modalSafe:     { flex: 1, backgroundColor: '#F0F4F8' },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.divider, backgroundColor: Colors.surface },
  modalTitle:    { fontSize: 17, fontWeight: '700', color: Colors.text },
  modalSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  modalCloseBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  modalSearch:   { margin: 16, marginBottom: 8 },
  modalLoading:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  modalLoadingText:  { color: Colors.textSecondary, fontSize: 13 },
  retryBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: Colors.primary },
  retryBtnText:      { color: Colors.primary, fontWeight: '700', fontSize: 14 },

  pickerRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.divider, backgroundColor: Colors.surface },
  pickerRowSelected: { backgroundColor: Colors.primaryMuted },
  pickerRowIcon:     { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primaryMuted, alignItems: 'center', justifyContent: 'center' },
  pickerRowInfo:     { flex: 1 },
  pickerRowTitle:    { fontSize: 15, fontWeight: '700', color: Colors.text },
  pickerRowSub:      { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  pickerStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: Colors.background },
  pickerStatusText:  { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  pickerEmpty:       { paddingVertical: 48, alignItems: 'center' },
  contractRefRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  contractPickerBtn: { width: 50, height: 50, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 0 },
  addManualRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.primaryLight, backgroundColor: Colors.primaryMuted },
  addManualIcon:     { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  addManualTitle:    { fontSize: 15, fontWeight: '700', color: Colors.primary },
  addManualSub:      { fontSize: 12, color: Colors.primary, opacity: 0.7, marginTop: 2 },

  cfBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  cfSheet:     { backgroundColor: Colors.surface, borderRadius: 24, width: '100%', maxHeight: '88%', overflow: 'hidden' },
  cfLottieRow: { alignItems: 'center', paddingTop: 20, paddingHorizontal: 16, width: '100%' },
  cfLottie:    { width: 130, height: 130 },
  cfHeader:    { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  cfTitle:     { fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  cfSubtitle:  { fontSize: 12, color: Colors.textSecondary, marginTop: 3, textAlign: 'center' },
  cfCloseBtn:  { position: 'absolute', top: 0, right: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  cfScroll:    { padding: 16, gap: 12, paddingBottom: 8 },
  cfCard:      { backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden' },
  cfRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  cfRowLabel:  { fontSize: 13, color: Colors.textSecondary, fontWeight: '500', width: 68 },
  cfRowValue:  { fontSize: 13, fontWeight: '700', color: Colors.text },
  cfCampusCard:      { backgroundColor: '#F8FAFC', borderRadius: 14, borderLeftWidth: 4, borderWidth: 1, borderColor: Colors.divider, padding: 12, gap: 8, marginBottom: 4 },
  cfCampusBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start' },
  cfCampusBadgeText: { fontSize: 12, fontWeight: '700' },
  cfMachineRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.divider },
  cfMachineNum:      { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cfMachineNumText:  { fontSize: 10, fontWeight: '800' },
  cfMachineId:       { fontSize: 12, fontWeight: '600', color: Colors.text, flex: 1 },
  cfMachineCounter:  { fontSize: 11, color: Colors.textSecondary },
  cfMachinePages:    { fontSize: 12, fontWeight: '700' },
  cfTotalCard:    { backgroundColor: Colors.primaryMuted, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.primaryLight, gap: 8 },
  cfTotalRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cfTotalLabel:   { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  cfTotalValue:   { fontSize: 18, fontWeight: '900', color: Colors.primary },
  cfTotalDivider: { height: 1, backgroundColor: Colors.primaryLight },
  cfActions:         { flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 32, borderTopWidth: 1, borderTopColor: Colors.divider },
  cfCancelBtn:       { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  cfCancelText:      { fontSize: 15, fontWeight: '700', color: Colors.textSecondary },
  cfConfirmBtn:      { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.primary, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 },
  cfConfirmText:     { fontSize: 15, fontWeight: '800', color: Colors.white },
  cfConfirmBtnLoading: { opacity: 0.7 },
  cfErrorBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 14, backgroundColor: '#FFF1F2', borderWidth: 1, borderColor: '#FECDD3' },
  cfErrorTitle:  { fontSize: 13, fontWeight: '700', color: Colors.error, marginBottom: 2 },
  cfErrorMsg:    { fontSize: 12, color: Colors.error, lineHeight: 17 },
  cfErrorDetail: { fontSize: 11, color: Colors.error, opacity: 0.8, lineHeight: 16 },
  cfErrorCode:   { fontSize: 10, color: Colors.error, opacity: 0.55, fontFamily: 'monospace', marginTop: 2 },
});

export default RentalInvoiceFormScreen;
