import React, { useEffect, useState, useRef } from "react";

function DangerAlert({ message, onClose }) {
  return (
    <>
      <div
        className="alert alert-danger alert-dismissible fade show mt-3"
        role="alert"
      >
        <strong>Error!</strong> {message}
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="alert"
          aria-label="Close"
          onClick={onClose}
        ></button>
      </div>
    </>
  );
}

export default DangerAlert;
