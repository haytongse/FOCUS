import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Switch, TouchableOpacity } from 'react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { createVendorApi, updateVendorApi, getVendorApi, getVendorsApi, ApiVendor } from '../../services/focusApi';
import { useAlert } from '../../components/AppAlert';

interface Props {
  vendor?: ApiVendor;
  onBack: () => void;
  onSaved: () => void;
}

const VendorFormScreen: React.FC<Props> = ({ vendor, onBack, onSaved }) => {
  const { showAlert } = useAlert();
  const isEdit = !!vendor;

  const [code, setCode] = useState(vendor?.code ?? '');
  const [nameEn, setNameEn] = useState(vendor?.nameEn ?? '');
  const [nameKm, setNameKm] = useState(vendor?.nameKm ?? '');
  const [address, setAddress] = useState(vendor?.address ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [contactEmail, setContactEmail] = useState(vendor?.contactEmail ?? '');
  const [bankName, setBankName] = useState(vendor?.bankName ?? '');
  const [bankAccount, setBankAccount] = useState(vendor?.bankAccount ?? '');
  const [paymentTermDays, setPaymentTermDays] = useState(
    vendor?.paymentTerm != null ? String(vendor.paymentTerm) : '',
  );
  const [active, setActive] = useState(vendor?.active !== false);
  const [vat, setVat] = useState(vendor?.vat ?? false);
  const [vatinNumber, setVatinNumber] = useState(vendor?.vatinNumber ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!vendor) return;
    getVendorApi(vendor.id).then(full => {
      setBankName(full.bankName ?? '');
      setBankAccount(full.bankAccount ?? '');
      setPaymentTermDays(full.paymentTerm != null ? String(full.paymentTerm) : '');
      setVat(full.vat ?? false);
      setVatinNumber(full.vatinNumber ?? '');
    }).catch(() => {});
  }, [vendor?.id]);

  const PAYMENT_TERM_OPTIONS = [
    { label: 'COD', days: 0 },
    { label: 'NET 15', days: 15 },
    { label: 'NET 30', days: 30 },
    { label: 'NET 45', days: 45 },
    { label: 'NET 60', days: 60 },
    { label: 'NET 90', days: 90 },
  ];

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!code.trim()) {
      e.code = 'Vendor code is required';
    } else if (!/^[A-Z0-9_-]{2,20}$/.test(code.trim())) {
      e.code = 'Code must be 2–20 uppercase letters, numbers, _ or -';
    }
    if (!nameEn.trim()) e.nameEn = 'English name is required';
    if (!nameKm.trim()) e.nameKm = 'Khmer name is required';
    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      e.contactEmail = 'Enter a valid email address';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      showAlert({
        type: 'error',
        title: 'Missing Required Fields',
        message: Object.values(e).join('\n'),
      });
      return false;
    }
    return true;
  };

  const doSave = async () => {
    setApiError(null);
    setLoading(true);
    try {
      const payload = {
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameKm: nameKm.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        bankName: bankName.trim() || undefined,
        bankAccount: bankAccount.trim() || undefined,
        paymentTerm: paymentTermDays !== '' ? Number(paymentTermDays) : undefined,
        active,
        vat,
        vatinNumber: vatinNumber.trim() || undefined,
      };
      if (isEdit) {
        await updateVendorApi(vendor!.id, payload);
      } else {
        await createVendorApi(payload);
      }
      onSaved();
    } catch (err: any) {
      setApiError(err?.message ?? `Failed to ${isEdit ? 'update' : 'create'} vendor`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!isEdit) {
      setLoading(true);
      try {
        const existing = await getVendorsApi();
        const duplicate = existing.find(v => v.code.toLowerCase() === code.trim().toLowerCase());
        if (duplicate) {
          showAlert({
            type: 'error',
            title: 'Code Already Exists',
            message: `Vendor code "${code.trim()}" is already used by "${duplicate.nameEn || duplicate.nameKm || duplicate.code}". Please choose a different code.`,
          });
          setErrors(e => ({ ...e, code: 'This code is already taken' }));
          return;
        }
      } catch {
        // ignore network error — let the server catch duplicates
      } finally {
        setLoading(false);
      }
    }
    const displayName = nameEn.trim() || nameKm.trim() || code.trim();
    showAlert({
      type: 'confirm',
      title: isEdit ? 'Save Changes' : 'Create Vendor',
      message: isEdit
        ? `Save changes to "${displayName}"?`
        : `Create vendor "${displayName}"?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        { label: isEdit ? 'Save' : 'Create', variant: 'primary', onPress: doSave },
      ],
    });
  };

  return (
    <View style={styles.safe}>
      <AppBar
        title={isEdit ? 'Edit Vendor' : 'New Vendor'}
        subtitle={isEdit ? `Code: ${vendor!.code}` : 'Add a supplier or vendor'}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {apiError ? (
          <View style={styles.errorBanner}>
            <AppText variant="caption" color="error">{apiError}</AppText>
          </View>
        ) : null}

        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Vendor Info</AppText>

          <AppInput
            label="Vendor Code *"
            value={code}
            onChangeText={v => setCode(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
            placeholder="e.g. VND001"
            autoCapitalize="none"
            maxLength={20}
            error={errors.code}
            hint="2–20 uppercase letters, numbers, _ or -"
            editable={!isEdit}
          />

          <AppInput
            label="English Name *"
            value={nameEn}
            onChangeText={setNameEn}
            placeholder="e.g. ABC Supplier Co."
            error={errors.nameEn}
          />

          <AppInput
            label="Khmer Name *"
            value={nameKm}
            onChangeText={setNameKm}
            placeholder="e.g. ក្រុមហ៊ុន ABC"
            error={errors.nameKm}
          />
        </View>

        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Contact Details</AppText>

          <AppInput
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="e.g. +855 12 345 678"
            keyboardType="phone-pad"
          />

          <AppInput
            label="Email"
            value={contactEmail}
            onChangeText={setContactEmail}
            placeholder="e.g. contact@supplier.com"
            keyboardType="email-address"
            autoCapitalize="none"
            error={errors.contactEmail}
          />

          <AppInput
            label="Address"
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. Phnom Penh, Cambodia"
          />
        </View>

        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Bank Account</AppText>

          <AppInput
            label="Bank Name"
            value={bankName}
            onChangeText={setBankName}
            placeholder="e.g. ABA Bank"
          />

          <AppInput
            label="Account Number"
            value={bankAccount}
            onChangeText={setBankAccount}
            placeholder="e.g. 000123456"
          />
        </View>

        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Payment Term</AppText>

          <View style={styles.termChips}>
            {PAYMENT_TERM_OPTIONS.map(opt => {
              const selected = paymentTermDays === String(opt.days);
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setPaymentTermDays(selected ? '' : String(opt.days))}
                  activeOpacity={0.75}
                >
                  <AppText style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {opt.label}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>

          <AppInput
            label="Custom Days"
            value={PAYMENT_TERM_OPTIONS.some(o => String(o.days) === paymentTermDays) ? '' : paymentTermDays}
            onChangeText={v => setPaymentTermDays(v.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 120"
            keyboardType="numeric"
            hint="Number of days (overrides chip selection)"
          />
        </View>

        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>VAT</AppText>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">VAT Registered</AppText>
              <AppText variant="caption" color="textSecondary">This vendor charges VAT on invoices</AppText>
            </View>
            <Switch
              value={vat}
              onValueChange={v => { setVat(v); if (!v) setVatinNumber(''); }}
              trackColor={{ true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>

          {vat ? (
            <AppInput
              label="VAT Identification Number (VATIN)"
              value={vatinNumber}
              onChangeText={setVatinNumber}
              placeholder="e.g. K001-123456789"
              autoCapitalize="characters"
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">Active</AppText>
              <AppText variant="caption" color="textSecondary">Inactive vendors won't appear in new orders</AppText>
            </View>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>
        </View>

        <AppButton
          label={isEdit ? 'Save Changes' : 'Create Vendor'}
          onPress={handleSave}
          loading={loading}
          fullWidth
          size="lg"
          style={styles.submitBtn}
        />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    gap: 4,
  },
  sectionLabel: {
    marginBottom: 12,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleInfo: { flex: 1, gap: 2 },
  termChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  chipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: Colors.primary,
    fontWeight: '700',
  },
  submitBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
});

export default VendorFormScreen;
