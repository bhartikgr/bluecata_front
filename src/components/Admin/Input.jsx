import React from 'react';

function Input({
  label,
  type = 'text',
  placeholder = '',
  value,
  onChange,
  name,
  className = '',
  labelClass = '',
  ...rest
}) {
  return (
    <div className="d-flex flex-column gap-0 inputwithlabel">
      {label && (
        <label htmlFor={name} className={`inputwithlabel_label ${labelClass}`}>
          {label}
        </label>
      )}
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={`inputwithlabel_input ${className}`}
        {...rest}
      />
    </div>
  );
}

export default Input;
