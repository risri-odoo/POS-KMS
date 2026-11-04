import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

interface TableProps {
  className?: string;
  /** On the table itself, e.g. a min-width so narrow screens scroll sideways. */
  tableClassName?: string;
  children: ReactNode;
}

export function Table({ className = '', tableClassName = '', children }: TableProps) {
  return (
    <div className={`overflow-hidden rounded-xl bg-white shadow-sm ${className}`}>
      <div className="overflow-x-auto">
        <table className={`w-full ${tableClassName}`}>{children}</table>
      </div>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-gray-100 bg-telivity-teal/5">{children}</tr>
    </thead>
  );
}

export function TableRow({ className = '', children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`border-b border-gray-50 last:border-b-0 ${className}`} {...rest}>
      {children}
    </tr>
  );
}

interface AlignProps {
  align?: 'left' | 'right';
}

export function TableHeader({ align = 'left', className = '', children, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & AlignProps) {
  const alignment = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th scope="col" className={`px-4 py-3 text-xs font-semibold uppercase text-telivity-slate ${alignment} ${className}`} {...rest}>
      {children}
    </th>
  );
}

interface TableCellProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'>, AlignProps {
  /** Main column of a row: darker and heavier, as in HAIP. */
  strong?: boolean;
}

export function TableCell({ align = 'left', strong = false, className = '', children, ...rest }: TableCellProps) {
  const alignment = align === 'right' ? 'text-right' : '';
  const tone = strong ? 'font-medium text-telivity-navy' : 'text-telivity-slate';
  return (
    <td className={`px-4 py-3 text-sm ${tone} ${alignment} ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">
        {children}
      </td>
    </tr>
  );
}
