import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import { useAuthViewModel } from '../../viewmodels/useAuthViewModel';
import { User } from '../../models/User';

interface LoginScreenProps {
  onLoginSuccess: (user: User, token: string, fcmToken?: string | null) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const { login, loading, error, clearError, fcmToken: authFcmToken } = useAuthViewModel();

  useEffect(() => {
    if (error) {
      setPasswordError(error);
      clearError();
    }
  }, [error, clearError]);

  const validate = (): boolean => {
    let valid = true;
    if (!email.trim()) {
      setEmailError('Email is required');
      valid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError('Enter a valid email');
      valid = false;
    } else {
      setEmailError('');
    }
    if (!password) {
      setPasswordError('Password is required');
      valid = false;
    } else if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      valid = false;
    } else {
      setPasswordError('');
    }
    return valid;
  };

  const handleLogin = async () => {
    clearError();
    if (!validate()) return;
    const result = await login({ email: email.trim(), password });
    if (result) {
      onLoginSuccess(result.user, result.token, authFcmToken);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoMini}>
            <AppText style={styles.logoLetter}>F</AppText>
          </View>
          <AppText variant="h3" style={styles.welcome}>
            Welcome back
          </AppText>
          <AppText variant="body" color="textSecondary">
            Sign in to your FOCUS account
          </AppText>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <AppInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={emailError}
          />

          <AppInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secureTextEntry
            secureToggle
            error={passwordError}
          />

          <TouchableOpacity style={styles.forgotRow}>
            <AppText variant="caption" color="primary">
              Forgot password?
            </AppText>
          </TouchableOpacity>

          <AppButton
            label="Sign In"
            onPress={handleLogin}
            loading={loading}
            fullWidth
            size="lg"
            style={styles.loginBtn}
          />
        </View>

        {/* Powered by */}
        <View style={styles.hint}>
          <AppText variant="caption" color="textSecondary" align="center">
            Powered by Focus Lab ERP
          </AppText>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingVertical: 40,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoMini: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  logoLetter: {
    color: Colors.white,
    fontSize: 38,
    fontWeight: '800',
  },
  welcome: {
    marginBottom: 6,
  },
  form: {
    gap: 0,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: 24,
    marginTop: -8,
  },
  loginBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  hint: {
    marginTop: 32,
  },
});

export default LoginScreen;
