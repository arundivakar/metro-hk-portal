import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Button component
 * @param {string} variant - primary | accent | success | danger | warning | outline | ghost
 * @param {string} size    - sm | md | lg
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';

  return (
    <button
      className={`btn btn-${variant} ${sizeClass} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <Loader2 size={14} className="spinner-icon" style={{ animation: 'spin 0.7s linear infinite' }} />
      ) : leftIcon ? (
        <span className="btn-icon">{leftIcon}</span>
      ) : null}
      {children}
      {rightIcon && !isLoading && <span className="btn-icon">{rightIcon}</span>}
    </button>
  );
}
