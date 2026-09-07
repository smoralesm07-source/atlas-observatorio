export function Mark({ size = 26, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="brand-mark" aria-hidden>
      {animated && (
        <circle cx="16" cy="16" r="9" fill="none" stroke="var(--accent)" strokeWidth="1.2"
          opacity="0.5" className="pulse-ring" />
      )}
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--line-strong)" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" opacity="0.75" />
      <circle cx="16" cy="16" r="3.4" fill="var(--accent)" />
      <path d="M16 3v3.2M16 25.8V29M3 16h3.2M25.8 16H29" stroke="var(--ink-4)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
