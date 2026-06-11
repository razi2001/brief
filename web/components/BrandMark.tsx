type BrandMarkProps = {
  size?: number;
  className?: string;
};

export default function BrandMark({ size = 32, className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect x="0" y="0" width="128" height="128" rx="28" fill="#dd6936" />
      {/* Three corner brackets (top-right replaced by the cloud) + the spark. */}
      <path
        fill="#f5f1e8"
        d="M26 38 Q26 26 38 26 L52 26 L52 34 L40 34 Q34 34 34 40 L34 52 L26 52 Z M26 90 Q26 102 38 102 L52 102 L52 94 L40 94 Q34 94 34 88 L34 76 L26 76 Z M102 90 Q102 102 90 102 L76 102 L76 94 L88 94 Q94 94 94 88 L94 76 L102 76 Z"
      />
      <path
        fill="#f5f1e8"
        d="M64 40 C67 52, 76 61, 88 64 C76 67, 67 76, 64 88 C61 76, 52 67, 40 64 C52 61, 61 52, 64 40 Z"
      />
      {/* Cloud edition: a white cloud where the top-right bracket was. */}
      <g fill="#ffffff">
        <ellipse cx="84" cy="40" rx="8" ry="7" />
        <ellipse cx="95" cy="35" rx="10" ry="9" />
        <ellipse cx="104" cy="40" rx="7" ry="6" />
        <rect x="80" y="38" width="28" height="9" rx="4" />
      </g>
    </svg>
  );
}
