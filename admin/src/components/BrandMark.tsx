type Variant = 'color' | 'mono';

type Props = {
  size?: number;
  variant?: Variant;
  className?: string;
};

export default function BrandMark({ size = 36, variant = 'color', className }: Props) {
  const arcColor = variant === 'mono' ? 'currentColor' : '#0066FF';
  const dotColor = variant === 'mono' ? 'currentColor' : '#FF9500';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      aria-label="Wasel"
      role="img"
      className={className}
    >
      <g fill="none" stroke={arcColor} strokeWidth="72" strokeLinecap="round">
        <path d="M 384.72 702.72 A 180 180 0 0 1 639.28 702.72" />
        <path d="M 271.60 589.60 A 340 340 0 0 1 752.40 589.60" />
        <path d="M 172.60 490.60 A 480 480 0 0 1 851.40 490.60" />
      </g>
      <circle cx="512" cy="830" r="72" fill={dotColor} />
    </svg>
  );
}
