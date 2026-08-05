import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, StyleProp, ViewStyle } from 'react-native';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';

export interface SignaturePadRef {
  clear: () => void;
  isEmpty: () => boolean;
  toSVGString: () => string;
  toPNG: () => Promise<string>;
}

interface Point { x: number; y: number; }

const toSmoothPath = (pts: Point[]): string => {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${(pts[0].x + 0.5).toFixed(1)},${pts[0].y.toFixed(1)}`;
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i].x + pts[i + 1].x) / 2).toFixed(1);
    const my = ((pts[i].y + pts[i + 1].y) / 2).toFixed(1);
    d += ` Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx},${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
  return d;
};

interface Props {
  style?: StyleProp<ViewStyle>;
  strokeColor?: string;
  strokeWidth?: number;
  onDrawStart?: () => void;
  onDrawEnd?: () => void;
}

const BASELINE_OFFSET = 44;
const INK_COLOR       = '#1A2C52';

const SignaturePad = forwardRef<SignaturePadRef, Props>(
  ({ style, strokeColor = INK_COLOR, strokeWidth = 3.5, onDrawStart, onDrawEnd }, ref) => {
    const [strokes, setStrokes]             = useState<Point[][]>([]);
    const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
    const currentRef                        = useRef<Point[]>([]);
    const [size, setSize]                   = useState({ w: 0, h: 0 });
    const svgRef                            = useRef<Svg>(null);

    useImperativeHandle(ref, () => ({
      clear: () => {
        setStrokes([]);
        setCurrentPoints([]);
        currentRef.current = [];
      },
      isEmpty: () => strokes.length === 0 && currentRef.current.length === 0,
      toSVGString: () => {
        const w = size.w || 300;
        const h = size.h || 180;
        const paths = strokes.map((pts, i) =>
          `<path key="${i}" d="${toSmoothPath(pts)}" stroke="${INK_COLOR}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
        ).join('');
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="background:#FAFBFF">${paths}</svg>`;
      },
      toPNG: () => new Promise<string>((resolve, reject) => {
        if (!svgRef.current) { reject(new Error('SVG not mounted')); return; }
        (svgRef.current as any).toDataURL((base64: string) => {
          if (!base64) { reject(new Error('toDataURL returned empty')); return; }
          resolve(`data:image/png;base64,${base64}`);
        });
      }),
    }));

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder:        () => true,
        onMoveShouldSetPanResponder:         () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture:  () => true,
        onPanResponderGrant: evt => {
          onDrawStart?.();
          const { locationX, locationY } = evt.nativeEvent;
          currentRef.current = [{ x: locationX, y: locationY }];
          setCurrentPoints([...currentRef.current]);
        },
        onPanResponderMove: evt => {
          const { locationX, locationY } = evt.nativeEvent;
          currentRef.current.push({ x: locationX, y: locationY });
          setCurrentPoints([...currentRef.current]);
        },
        onPanResponderRelease: () => {
          if (currentRef.current.length > 0) {
            const pts = currentRef.current.slice();
            currentRef.current = [];
            setCurrentPoints([]);
            setStrokes(prev => [...prev, pts]);
          }
          onDrawEnd?.();
        },
        onPanResponderTerminate: () => {
          if (currentRef.current.length > 0) {
            const pts = currentRef.current.slice();
            currentRef.current = [];
            setCurrentPoints([]);
            setStrokes(prev => [...prev, pts]);
          }
          onDrawEnd?.();
        },
        onShouldBlockNativeResponder: () => true,
      }),
    ).current;

    const isEmpty   = strokes.length === 0 && currentPoints.length === 0;
    const baselineY = size.h > 0 ? size.h - BASELINE_OFFSET : 0;
    const xLeft     = 20;

    return (
      <View
        style={[styles.container, style]}
        onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        {...panResponder.panHandlers}
      >
        {size.w > 0 && (
          <Svg ref={svgRef} width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
            <Line
              x1={xLeft} y1={baselineY}
              x2={size.w - 20} y2={baselineY}
              stroke="#CBD5E1" strokeWidth={1} strokeDasharray="4,4"
            />
            <SvgText x={xLeft} y={baselineY - 6} fontSize={18} fontWeight="700" fill="#94A3B8">
              ×
            </SvgText>
            {isEmpty && (
              <SvgText
                x={size.w / 2} y={baselineY - 28}
                fontSize={14} fill="#B0BEC5"
                textAnchor="middle" fontStyle="italic"
              >
                Draw signature here
              </SvgText>
            )}
            {strokes.map((pts, i) => (
              <Path
                key={i} d={toSmoothPath(pts)}
                stroke={strokeColor} strokeWidth={strokeWidth}
                strokeLinecap="round" strokeLinejoin="round" fill="none"
              />
            ))}
            {currentPoints.length > 0 && (
              <Path
                d={toSmoothPath(currentPoints)}
                stroke={strokeColor} strokeWidth={strokeWidth}
                strokeLinecap="round" strokeLinejoin="round" fill="none"
              />
            )}
          </Svg>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FAFBFF',
    minHeight: 150,
  },
});

export default SignaturePad;
