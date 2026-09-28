const points = [
  [51, 9, 3], [73, 14, 2], [91, 24, 2], [28, 26, 2], [54, 32, 2], [77, 38, 3],
  [18, 48, 3], [41, 48, 2], [61, 52, 3], [91, 54, 2], [27, 71, 2], [51, 74, 3],
  [74, 71, 2], [42, 92, 2], [61, 93, 3]
] as const;

const traces = [
  [51, 9, 73, 14], [51, 9, 54, 32], [28, 26, 54, 32], [54, 32, 77, 38],
  [18, 48, 41, 48], [41, 48, 61, 52], [61, 52, 91, 54], [27, 71, 51, 74],
  [51, 74, 74, 71], [42, 92, 61, 93], [41, 48, 27, 71], [61, 52, 51, 74]
] as const;

export const ConnectedPointsVisual = () => (
  <div aria-hidden="true" className="connected-points-visual">
    <svg viewBox="0 0 110 110" role="presentation">
      <g className="connected-points-visual__traces">
        {traces.map(([x1, y1, x2, y2]) => <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} x2={x2} y1={y1} y2={y2} />)}
      </g>
      <g className="connected-points-visual__points">
        {points.map(([cx, cy, radius]) => <circle cx={cx} cy={cy} key={`${cx}-${cy}`} r={radius} />)}
      </g>
    </svg>
  </div>
);
