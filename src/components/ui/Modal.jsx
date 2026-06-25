import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Modal component with backdrop, header, body, footer
 * @param {boolean} isOpen
 * @param {function} onClose
 * @param {string} title
 * @param {string} size - sm | md | lg
 */
export default function Modal({ isOpen, onClose, title, size = 'md', children, footer }) {
  const backdropRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) onClose?.();
  };

  const sizeClass = size === 'lg' ? 'modal-lg' : size === 'sm' ? 'modal-sm' : '';

  return createPortal(
    <div className="modal-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className={`modal ${sizeClass}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 className="modal-title" id="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
