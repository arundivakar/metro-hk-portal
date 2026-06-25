import React from 'react';

export default function Spinner({ size = 'md', variant = 'accent', className = '' }) {
  const sizeClass = size === 'sm' ? 'spinner-sm' : size === 'lg' ? 'spinner-lg' : '';
  const variantClass = variant === 'primary' ? 'spinner-primary' : variant === 'white' ? 'spinner-white' : '';
  return <span className={`spinner ${sizeClass} ${variantClass} ${className}`} role="status" aria-label="Loading" />;
}

export function PageLoader() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      background: 'var(--content-bg)',
    }}>
      <Spinner size="lg" variant="primary" />
      <p style={{ color: 'var(--color-gray-500)', fontSize: 'var(--font-size-sm)' }}>
        Loading Metro HK Portal…
      </p>
    </div>
  );
}
