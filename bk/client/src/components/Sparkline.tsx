/**
 * Sprint 10 — Sparkline (12-point inline chart for KPI strip).
 *
 * Pure SVG, no external dependency, dark/light-mode aware via currentColor.
 */
type Props = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  testid?: string;
};
export function Sparkline({ data, width = 80, height = 24, stroke = "currentColor", fill = "none", strokeWidth = 1.5, testid }: Props) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} data-testid={testid} role="presentation" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = height - ((d - min) / range) * (height - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const path = `M${points.join(" L")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} data-testid={testid} role="img" aria-label="trend">
      <path d={path} stroke={stroke} fill={fill} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
