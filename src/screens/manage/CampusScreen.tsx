import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { CAMPUSES } from '../../models/Campus';

interface Props {
  onBack: () => void;
}

const CampusScreen: React.FC<Props> = ({ onBack }) => {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Campus name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    // Campus is local config — no API endpoint exists
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <AppText variant="h4">Campus</AppText>
          <AppText variant="caption" color="textSecondary">Manage campus locations</AppText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Info */}
        <View style={styles.infoBanner}>
          <Icon name="info" size={18} color={Colors.info} />
          <AppText variant="caption" style={styles.infoText}>
            Campus locations are configured locally. Contact your administrator to add a campus to the server.
          </AppText>
        </View>

        {/* Existing Campuses */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Configured Campuses</AppText>
          {CAMPUSES.map((campus, i) => (
            <View key={campus.id} style={[styles.campusRow, i < CAMPUSES.length - 1 && styles.campusDivider]}>
              <View style={styles.campusIcon}>
                <Icon name="location-city" size={20} color={Colors.primary} />
              </View>
              <View style={styles.campusInfo}>
                <AppText variant="body" style={styles.campusName}>{campus.name}</AppText>
                <AppText variant="caption" color="textSecondary">Code: {campus.code}</AppText>
              </View>
              <View style={styles.campusBadge}>
                <AppText variant="caption" style={styles.campusBadgeText}>Active</AppText>
              </View>
            </View>
          ))}
        </View>

        {/* Add New (local only) */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Add Campus (Preview)</AppText>

          <AppInput
            label="Campus Name *"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Main Campus"
            error={errors.name}
          />

          <AppInput
            label="Location / Address"
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Phnom Penh, Cambodia"
          />

          <AppButton
            label="Save Campus"
            onPress={handleSave}
            fullWidth
            size="md"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerText: {
    flex: 1,
  },
  scroll: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.infoLight,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.info,
    gap: 8,
  },
  infoText: {
    flex: 1,
    color: '#1E40AF',
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
  },
  sectionLabel: {
    marginBottom: 16,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '600',
  },
  campusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  campusDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  campusIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campusInfo: {
    flex: 1,
    gap: 2,
  },
  campusName: {
    fontWeight: '600',
  },
  campusBadge: {
    backgroundColor: Colors.successLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  campusBadgeText: {
    color: Colors.success,
    fontWeight: '600',
    fontSize: 11,
  },
});

export default CampusScreen;
