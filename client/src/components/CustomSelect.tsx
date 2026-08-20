import React, { useState } from 'react';
import './custom-select.css';

export interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select option',
  className = '',
  style
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value);
  const selectedLabel = selectedOption ? selectedOption.label : placeholder;

  return (
    <div className={`custom-select-wrapper ${className}`} style={style}>
      <div
        className="custom-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="selected-text">{selectedLabel}</span>
        <span className={`chevron-icon ${isOpen ? 'open' : ''}`}>▼</span>
      </div>

      {isOpen && (
        <>
          <div className="custom-select-backdrop" onClick={() => setIsOpen(false)} />
          <div className="custom-select-dropdown animate-fade-in">
            {options.map((opt) => (
              <div
                key={opt.value}
                className={`custom-select-option ${value === opt.value ? 'selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CustomSelect;
