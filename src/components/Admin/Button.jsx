import React from 'react';

function Button({ text = "Click Me" }) {
  return (
    <button
      className="global_btn_admin"
    >
      {text}
    </button>
  );
}

export default Button;
