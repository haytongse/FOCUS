import React from 'react';
import { Text, TextProps, TextStyle, StyleProp } from 'react-native';
import Colors from '../theme/colors';
import { FontSize, FontWeight } from '../theme/typography';

type TextVariant =
  | 'h1' | 'h2' | 'h3' | 'h4'
  | 'body' | 'bodyMedium'
  | 'caption' | 'label' | 'button';

type TextColor =
  | 'primary' | 'secondary' | 'text' | 'textSecondary'
  | 'textLight' | 'inverse' | 'error' | 'success' | 'warning';

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: TextColor;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
}

const variantStyles: Record<TextVariant, TextStyle> = {
  h1: { fontSize: FontSize['4xl'], fontWeight: FontWeight.bold, letterSpacing: -0.5 },
  h2: { fontSize: FontSize['3xl'], fontWeight: FontWeight.bold },
  h3: { fontSize: FontSize['2xl'], fontWeight: FontWeight.semibold },
  h4: { fontSize: FontSize.xl, fontWeight: FontWeight.semibold },
  body: { fontSize: FontSize.base, fontWeight: FontWeight.regular },
  bodyMedium: { fontSize: FontSize.base, fontWeight: FontWeight.medium },
  caption: { fontSize: FontSize.sm, fontWeight: FontWeight.regular },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, letterSpacing: 0.3 },
  button: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, letterSpacing: 0.3 },
};

const colorMap: Record<TextColor, string> = {
  primary: Colors.primary,
  secondary: Colors.secondary,
  text: Colors.text,
  textSecondary: Colors.textSecondary,
  textLight: Colors.textLight,
  inverse: Colors.textInverse,
  error: Colors.error,
  success: Colors.success,
  warning: Colors.warning,
};

const AppText: React.FC<AppTextProps> = ({
  variant = 'body',
  color = 'text',
  align = 'left',
  style,
  children,
  ...rest
}) => {
  return (
    <Text
      style={[
        variantStyles[variant],
        { color: colorMap[color], textAlign: align },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
};

export default AppText;
