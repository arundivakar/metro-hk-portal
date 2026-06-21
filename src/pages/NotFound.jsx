import React from 'react';
import { Link } from 'react-router-dom';
import { Home, Train } from 'lucide-react';
import Button from '../components/ui/Button';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--content-bg)', gap: 'var(--space-6)', padding: 'var(--space-8)',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 20,
        background: 'linear-gradient(135deg, var(--color-primary-100), var(--color-accent-100))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-primary-600)',
      }}>
        <Train size={36} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '5rem', fontWeight: 800, color: 'var(--color-gray-200)', lineHeight: 1 }}>
          404
        </h1>
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-gray-800)', marginTop: 'var(--space-2)' }}>
          Page not found
        </h2>
        <p style={{ color: 'var(--color-gray-500)', marginTop: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
          The page you're looking for doesn't exist or you don't have access.
        </p>
      </div>
      <Link to="/dashboard">
        <Button variant="primary" leftIcon={<Home size={16} />}>Back to Dashboard</Button>
      </Link>
    </div>
  );
}
