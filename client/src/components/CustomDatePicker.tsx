import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './custom-datepicker.css';

interface CustomDatePickerProps {
  value: string; // Format: YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  value,
  onChange,
  placeholder = 'Select date',
  className = ''
}) => {
  // Convert YYYY-MM-DD string safely to Date object
  const selectedDate = useMemo(() => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }, [value]);

  const handleDateChange = (date: Date | null) => {
    if (date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      onChange(`${year}-${month}-${day}`);
    } else {
      onChange('');
    }
  };

  return (
    <div className={`custom-datepicker-wrapper ${className}`}>
      <DatePicker
        selected={selectedDate}
        onChange={handleDateChange}
        dateFormat="dd/MM/yyyy"
        className="custom-datepicker-input"
        placeholderText={placeholder}
      />
    </div>
  );
};

import { useMemo } from 'react';
export default CustomDatePicker;
