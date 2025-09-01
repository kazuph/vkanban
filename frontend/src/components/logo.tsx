export function Logo({ className = '' }: { className?: string }) {
  return (
    <span
      aria-label="VKanban Logo"
      className={`inline-block logo-monochrome h-5 sm:h-6 w-[120px] sm:w-[140px] ${className}`}
      role="img"
    />
  );
}
