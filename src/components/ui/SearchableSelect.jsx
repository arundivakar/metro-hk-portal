import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check } from 'lucide-react';
import './SearchableSelect.css';

export default function SearchableSelect({
  options = [],
  value,
  onChange,
  onOpenChange,
  placeholder = 'Select an option...',
  disabled = false,
  required = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownPos, setDropdownPos] = useState({
    top: 0,
    left: 0,
    width: 320,
    placement: 'bottom',
    maxHeight: 330
  });

  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  // Find currently selected option object
  const selectedOption = options.find((opt) => opt.value === value);

  // Calculate position relative to viewport
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // If trigger has scrolled out of view, close
    if (rect.bottom < 0 || rect.top > viewportHeight) {
      setIsOpen(false);
      onOpenChange?.(false);
      return;
    }

    const spaceBelow = viewportHeight - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const width = Math.max(rect.width, 320);

    // Keep horizontally within viewport
    let left = rect.left;
    if (left + width > viewportWidth - 12) {
      left = Math.max(12, viewportWidth - width - 12);
    }

    // Determine placement (flip up if not enough space below and more space above)
    let placement = 'bottom';
    let top = rect.bottom + 4;
    let maxHeight = 330;

    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      placement = 'top';
      maxHeight = Math.min(330, Math.max(160, spaceAbove - 46));
      top = rect.top - 4;
    } else {
      placement = 'bottom';
      maxHeight = Math.min(330, Math.max(160, spaceBelow - 46));
      top = rect.bottom + 4;
    }

    setDropdownPos({ top, left, width, placement, maxHeight });
  }, [onOpenChange]);

  // Recalculate position on open, scroll, or resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen, updatePosition]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event) {
      const isInsideTrigger = triggerRef.current && triggerRef.current.contains(event.target);
      const isInsideDropdown = dropdownRef.current && dropdownRef.current.contains(event.target);

      if (!isInsideTrigger && !isInsideDropdown) {
        setIsOpen(false);
        onOpenChange?.(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        onOpenChange?.(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 40);
      return () => clearTimeout(timer);
    } else {
      setSearchTerm('');
    }
  }, [isOpen]);

  const filteredOptions = options.filter((opt) => {
    const term = searchTerm.toLowerCase();
    const labelMatch = (opt.label || '').toLowerCase().includes(term);
    const sublabelMatch = opt.sublabel && String(opt.sublabel).toLowerCase().includes(term);
    return labelMatch || sublabelMatch;
  });

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
    onOpenChange?.(false);
    setSearchTerm('');
  };

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen((prev) => {
        const next = !prev;
        onOpenChange?.(next);
        return next;
      });
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={`searchable-select-wrapper ${disabled ? 'disabled' : ''} ${isOpen ? 'open' : ''}`}
    >
      {/* Hidden input for HTML form validation */}
      <input
        type="text"
        required={required}
        value={value || ''}
        onChange={() => {}}
        style={{ opacity: 0, position: 'absolute', height: 0, width: 0, pointerEvents: 'none' }}
      />

      <div
        ref={triggerRef}
        className={`searchable-select-trigger ${isOpen ? 'open' : ''} form-control`}
        onClick={handleToggle}
      >
        <span className="searchable-select-value">
          {selectedOption ? selectedOption.label : <span className="placeholder">{placeholder}</span>}
        </span>
        <ChevronDown size={16} className="searchable-select-icon" />
      </div>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="searchable-select-dropdown"
            style={{
              position: 'fixed',
              top: dropdownPos.placement === 'top' ? 'auto' : `${dropdownPos.top}px`,
              bottom: dropdownPos.placement === 'top' ? `${window.innerHeight - dropdownPos.top}px` : 'auto',
              left: `${dropdownPos.left}px`,
              width: `${dropdownPos.width}px`,
              zIndex: 10050,
            }}
          >
            <div className="searchable-select-search">
              <Search size={14} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search materials..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            <ul
              className="searchable-select-list"
              style={{ maxHeight: `${dropdownPos.maxHeight}px` }}
            >
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt) => (
                  <li
                    key={opt.value}
                    className={`searchable-select-item ${value === opt.value ? 'selected' : ''}`}
                    onClick={() => handleSelect(opt.value)}
                  >
                    <div className="item-content">
                      <span className="item-label">{opt.label}</span>
                      {opt.sublabel && <span className="item-sublabel">{opt.sublabel}</span>}
                    </div>
                    {value === opt.value && <Check size={16} className="check-icon" />}
                  </li>
                ))
              ) : (
                <li className="searchable-select-empty">No results found</li>
              )}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
