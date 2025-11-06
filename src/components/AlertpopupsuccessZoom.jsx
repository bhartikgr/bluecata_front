import React, { useEffect, useState } from "react";

function AlertpopupsuccessZoom({ children, onClose }) {
  const [fade, setFade] = useState("show");

  // useEffect(() => {
  //   const fadeTimer = setTimeout(() => {
  //     setFade("");
  //   }, 2500);

  //   const closeTimer = setTimeout(() => {
  //     onClose();
  //   }, 3000);

  //   return () => {
  //     clearTimeout(fadeTimer);
  //     clearTimeout(closeTimer);
  //   };
  // }, [onClose]);

  return (
    <div
      className={`alert alert-success alert-dismissible fade ${fade}`}
      role="alert"
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: 9999,
        minWidth: "300px",
        maxWidth: "90%",
      }}
    >
      {/* Render the children passed from parent */}
      {children}

      <button
        type="button"
        className="btn-close"
        aria-label="Close"
        onClick={onClose}
      ></button>
    </div>
  );
}

export default AlertpopupsuccessZoom;
