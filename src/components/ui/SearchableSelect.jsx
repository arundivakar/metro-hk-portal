import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import './SearchableSelect.css';

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select an option...',
  disabled = false,
  required = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef(null);
  
  // Find currently selected option object
  const selectedOption = options.find(opt => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (opt.sublabel && opt.sublabel.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`searchable-select-wrapper ${disabled ? 'disabled' : ''}`} ref={wrapperRef}>
      {/* Hidden input for form validation */}
      <input 
        type="text" 
        required={required} 
        value={value || ''} 
        onChange={() => {}} 
        style={{ opacity: 0, position: 'absolute', height: 0, width: 0, pointerEvents: 'none' }} 
      />

      <div 
        className={`searchable-select-trigger ${isOpen ? 'open' : ''} form-control`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span className="searchable-select-value">
          {selectedOption ? selectedOption.label : <span className="placeholder">{placeholder}</span>}
        </span>
        <ChevronDown size={16} className="searchable-select-icon" />
      </div>

      {isOpen && (
        <div className="searchable-select-dropdown">
          <div className="searchable-select-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          
          <ul className="searchable-select-list">
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
        </div>
      )}
    </div>
  );
}
