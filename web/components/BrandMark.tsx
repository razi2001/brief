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
      <path
        fill="#f5f1e8"
        d="M26 38 Q26 26 38 26 L52 26 L52 34 L40 34 Q34 34 34 40 L34 52 L26 52 Z M102 38 Q102 26 90 26 L76 26 L76 34 L88 34 Q94 34 94 40 L94 52 L102 52 Z M26 90 Q26 102 38 102 L52 102 L52 94 L40 94 Q34 94 34 88 L34 76 L26 76 Z M102 90 Q102 102 90 102 L76 102 L76 94 L88 94 Q94 94 94 88 L94 76 L102 76 Z"
      />
      <path
        fill="#f5f1e8"
        d="M64 40 C67 52, 76 61, 88 64 C76 67, 67 76, 64 88 C61 76, 52 67, 40 64 C52 61, 61 52, 64 40 Z"
      />
    </svg>
  );
}
