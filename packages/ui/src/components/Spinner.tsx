import { RefreshCw } from 'lucide-react';

interface SpinnerProps {
  size?: number;
  label?: string;
  className?: string;
}

/** HAIP has no spinner component; this is the spinning icon it uses for refreshes. */
export function Spinner({ size = 16, label = 'Loading', className = '' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={`inline-flex ${className}`}>
      <RefreshCw size={size} className="animate-spin" aria-hidden="true" />
    </span>
  );
}
