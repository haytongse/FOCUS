import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import Colors from '../theme/colors';
import AppText from './AppText';
import AppButton from './AppButton';

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertType = 'info' | 'success' | 'warning' | 'error' | 'confirm';

interface AlertAction {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
}

interface AlertConfig {
  type?: AlertType;
  title: string;
  message?: string;
  actions?: AlertAction[];
  dismissable?: boolean;
  autoClose?: number;
  lottieSource?: object;
  icon?: string;
}

interface AlertContextValue {
  showAlert: (config: AlertConfig) => void;
  hideAlert: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AlertContext = createContext<AlertContextValue>({
  showAlert: () => {},
  hideAlert: () => {},
});

export const useAlert = () => useContext(AlertContext);

// ─── Alert config maps ────────────────────────────────────────────────────────

const typeConfig: Record<AlertType, { icon: string; color: string; bg: string }> = {
  info:    { icon: 'info',           color: Colors.primary, bg: Colors.primaryLight },
  success: { icon: 'check-circle',   color: Colors.success, bg: Colors.successLight },
  warning: { icon: 'warning',        color: Colors.warning, bg: Colors.warningLight },
  error:   { icon: 'error',          color: Colors.error,   bg: Colors.errorLight },
  confirm: { icon: 'help',           color: Colors.primary, bg: Colors.primaryLight },
};

// ─── Provider + Modal ─────────────────────────────────────────────────────────

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<AlertConfig>({ title: '' });
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showAlert = useCallback((cfg: AlertConfig) => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    setConfig(cfg);
    setVisible(true);
    scaleAnim.setValue(0.85);
    opacityAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    if (cfg.autoClose) {
      autoCloseTimer.current = setTimeout(() => hideAlert(), cfg.autoClose);
    }
  }, []);

  const hideAlert = useCallback(() => {
    if (autoCloseTimer.current) { clearTimeout(autoCloseTimer.current); autoCloseTimer.current = null; }
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.88, duration: 150, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      setConfig({ title: '' }); // clear stale actions so back-button can't replay them
    });
  }, []);

  const handleAction = (action: AlertAction) => {
    hideAlert();
    setTimeout(() => action.onPress?.(), 200);
  };

  const type = config.type ?? 'info';
  const { icon: defaultIcon, color, bg } = typeConfig[type];
  const icon = config.icon ?? defaultIcon;

  const defaultActions: AlertAction[] =
    config.actions ?? [{ label: 'OK', variant: 'primary' }];

  return (
    <AlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => config.dismissable !== false && hideAlert()}
      >
        <Animated.View style={[styles.backdrop, { opacity: opacityAnim }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => config.dismissable !== false && hideAlert()}
          />
          <Animated.View
            style={[styles.card, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}
          >
            {/* Icon / Lottie */}
            {config.lottieSource ? (
              <LottieView
                source={config.lottieSource}
                autoPlay
                loop={false}
                style={styles.lottieIcon}
              />
            ) : (
              <View style={[styles.iconCircle, { backgroundColor: bg }]}>
                <Icon name={icon} size={32} color={color} />
              </View>
            )}

            {/* Title */}
            <AppText variant="h4" align="center" style={styles.title}>
              {config.title}
            </AppText>

            {/* Message */}
            {config.message && (
              <AppText variant="body" color="textSecondary" align="center" style={styles.message}>
                {config.message}
              </AppText>
            )}

            {/* Divider */}
            <View style={styles.divider} />

            {/* Actions */}
            <View style={[styles.actions, defaultActions.length === 1 && styles.actionsSingle]}>
              {defaultActions.map((action, i) => (
                <AppButton
                  key={i}
                  label={action.label}
                  onPress={() => handleAction(action)}
                  variant={action.variant ?? (i === 0 && defaultActions.length > 1 ? 'outline' : 'primary')}
                  size="md"
                  style={defaultActions.length === 1
                    ? [styles.actionBtn, styles.actionBtnFull]
                    : styles.actionBtn
                  }
                />
              ))}
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </AlertContext.Provider>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
    elevation: 20,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  lottieIcon: {
    width: 100,
    height: 100,
    marginBottom: 8,
  },
  title: {
    marginBottom: 8,
  },
  message: {
    lineHeight: 22,
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    width: '100%',
    marginTop: 20,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  actionsSingle: {
    justifyContent: 'center',
  },
  actionBtn: {
    flex: 1,
  },
  actionBtnFull: {
    flex: 1,
  },
});
