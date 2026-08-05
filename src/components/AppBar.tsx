import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../theme/colors';
import AppText from './AppText';

interface AppBarProps {
  title: string;
  subtitle?: string;
  backgroundColor?: string;
  titleColor?: string;
  titleAlign?: 'left' | 'center';
  showBack?: boolean;
  onBack?: () => void;
  rightActions?: React.ReactNode;
  style?: ViewStyle;
}

const AppBar: React.FC<AppBarProps> = ({
  title,
  subtitle,
  backgroundColor = Colors.primary,
  titleColor = Colors.white,
  titleAlign = 'center',
  showBack = false,
  onBack,
  rightActions,
  style,
}) => {
  const insets = useSafeAreaInsets();
  const isLeft = titleAlign === 'left';

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={backgroundColor} />
      <View
        style={[
          styles.container,
          {
            backgroundColor,
            paddingTop: insets.top,
            shadowColor: backgroundColor,
          },
          style,
        ]}
      >
        {/* Shimmer overlay */}
        <Svg
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id="shimmer" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.18" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#shimmer)" />
        </Svg>

        <View style={styles.inner}>
          {isLeft ? (
            <>
              {showBack && (
                <TouchableOpacity
                  onPress={onBack}
                  style={styles.iconBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="arrow-back" size={24} color={titleColor} />
                </TouchableOpacity>
              )}
              <View style={styles.titleLeft}>
                <AppText
                  style={[styles.titleLeftText, { color: titleColor }]}
                  numberOfLines={1}
                >
                  {title}
                </AppText>
                {subtitle && (
                  <AppText
                    variant="caption"
                    style={[styles.subtitle, { color: `${titleColor}B3` }]}
                    numberOfLines={1}
                  >
                    {subtitle}
                  </AppText>
                )}
              </View>
              <View style={styles.rightActions}>{rightActions}</View>
            </>
          ) : (
            <>
              <View style={styles.left}>
                {showBack && (
                  <TouchableOpacity
                    onPress={onBack}
                    style={styles.iconBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="arrow-back" size={24} color={titleColor} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.center}>
                <AppText
                  variant="h4"
                  style={[styles.title, { color: titleColor }]}
                  numberOfLines={1}
                >
                  {title}
                </AppText>
                {subtitle && (
                  <AppText
                    variant="caption"
                    style={[styles.subtitle, { color: `${titleColor}B3` }]}
                    numberOfLines={1}
                  >
                    {subtitle}
                  </AppText>
                )}
              </View>
              <View style={styles.right}>{rightActions}</View>
            </>
          )}
        </View>

        {/* Bottom accent line */}
        <View style={styles.bottomLine} />
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    minHeight: 56,
  },
  bottomLine: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginHorizontal: 16,
    borderRadius: 2,
    marginBottom: 4,
  },

  // Centered layout
  left: {
    width: 48,
    alignItems: 'flex-start',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  right: {
    width: 48,
    alignItems: 'flex-end',
  },
  title: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Left-aligned layout
  titleLeft: {
    flex: 1,
    paddingLeft: 8,
    justifyContent: 'center',
  },
  titleLeftText: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  rightActions: {
    alignItems: 'flex-end',
    paddingRight: 4,
  },

  subtitle: {
    marginTop: 1,
  },
  iconBtn: {
    padding: 4,
  },
});

export default AppBar;
