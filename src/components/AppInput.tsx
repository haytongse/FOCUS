import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../theme/colors';
import { FontSize } from '../theme/typography';
import AppText from './AppText';

interface AppInputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  secureToggle?: boolean;
  containerStyle?: ViewStyle;
}

const AppInput: React.FC<AppInputProps> = ({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  secureToggle = false,
  containerStyle,
  secureTextEntry,
  editable,
  onBlur,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);
  const [secure, setSecure] = useState(secureTextEntry ?? false);

  const isDisabled = editable === false;
  const hasError = !!error;
  const borderColor = isDisabled
    ? Colors.border
    : hasError
    ? Colors.error
    : focused
    ? Colors.primary
    : Colors.border;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <AppText variant="label" style={styles.label}>
          {label}
        </AppText>
      )}
      <View style={[styles.inputWrapper, { borderColor }, isDisabled && styles.inputWrapperDisabled]}>
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          style={[styles.input, leftIcon ? styles.inputWithLeft : null, isDisabled && styles.inputDisabled]}
          placeholderTextColor={Colors.textLight}
          autoCorrect={false}
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={e => {
            setFocused(false);
            onBlur?.(e);
          }}
          secureTextEntry={secureToggle ? secure : secureTextEntry}
          editable={editable}
          {...rest}
        />
        {secureToggle && (
          <TouchableOpacity
            onPress={() => setSecure(v => !v)}
            style={styles.rightIcon}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon
              name={secure ? 'visibility-off' : 'visibility'}
              size={22}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>
        )}
        {!secureToggle && rightIcon && (
          <View style={styles.rightIcon}>{rightIcon}</View>
        )}
      </View>
      {hasError ? (
        <AppText variant="caption" color="error" style={styles.hint}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="textSecondary" style={styles.hint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
    color: Colors.text,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    minHeight: 50,
  },
  inputWrapperDisabled: {
    backgroundColor: Colors.background,
  },
  input: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputDisabled: {
    color: Colors.textSecondary,
  },
  inputWithLeft: {
    paddingLeft: 8,
  },
  leftIcon: {
    paddingLeft: 14,
  },
  rightIcon: {
    paddingRight: 14,
  },
  hint: {
    marginTop: 4,
    marginLeft: 2,
  },
});

export default AppInput;
