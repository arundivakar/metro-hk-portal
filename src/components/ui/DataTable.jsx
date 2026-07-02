import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import Spinner from './Spinner';
import EmptyState from './EmptyState';

/**
 * DataTable — UI polished. Zero logic/API/prop changes.
 * Added: sort-active class on th, improved sort icon visibility.
 */
export default function DataTable({
  columns = [],
  data = [],
  isLoading = false,
  emptyTitle = 'No records found',
  emptyDesc = 'There are no records to display.',
  emptyIcon,
  rowKey = 'id',
  onRowClick,
  className = '',
  stickyHeader = true,
  footer,
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  if (isLoading) {
    return (
      <div style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (sortedData.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDesc} icon={emptyIcon} />;
  }

  const SortIcon = ({ colKey }) => {
    if (sortKey !== colKey) return <ChevronsUpDown size={11} style={{ opacity: 0.3, flexShrink: 0 }} />;
    return sortDir === 'asc'
      ? <ChevronUp   size={11} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />
      : <ChevronDown size={11} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />;
  };

  return (
    <div
      className={`table-wrapper ${className}`}
      style={stickyHeader ? { maxHeight: '65vh', overflowY: 'auto' } : {}}
    >
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align ?? 'left' }}
                className={[
                  col.sortable ? 'sortable' : '',
                  col.sortable && sortKey === col.key ? 'sort-active' : '',
                ].filter(Boolean).join(' ')}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                aria-sort={
                  col.sortable
                    ? sortKey === col.key
                      ? sortDir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                    : undefined
                }
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {col.sortable && <SortIcon colKey={col.key} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, rowIndex) => {
            const rowClasses = [
              row._rowClass ?? '',
              row._zeroStock ? 'zero-stock-row' : '',
            ].filter(Boolean).join(' ');

            return (
              <tr
                key={row[rowKey] ?? rowIndex}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
                className={rowClasses}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align ?? 'left' }}
                    className={col.key === 'actions' ? 'col-actions' : ''}
                  >
                    {col.render ? col.render(row[col.key], row, rowIndex) : (row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && (
          <tfoot>
            {footer}
          </tfoot>
        )}
      </table>
    </div>
  );
}
