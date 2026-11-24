/** WCAG 2.x contrast ratio between two "#rrggbb" colors. Pure, so a test can check both themes. */
const channel = (value: number): number => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((index) => channel(Number.parseInt(hex.slice(index, index + 2), 16))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (first: string, second: string): number => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
};

/** The hex colors inside a CSS gradient string, in order. */
export const hexColorsIn = (value: string): string[] => value.match(/#[0-9a-fA-F]{6}\b/gu) ?? [];
