import React, { useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

function DangerAlertPopupMessage({ message, onClose }) {
  // Handle escape key press
  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.keyCode === 27) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscKey);
    return () => {
      document.removeEventListener("keydown", handleEscKey);
    };
  }, [onClose]);

  return (
    <div
      className="modal show d-block"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        zIndex: 1050,
        backdropFilter: "blur(3px)",
      }}
      tabIndex="-1"
      role="dialog"
    >
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div
          className="modal-content border-0 shadow-lg"
          style={{
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow:
              "0 10px 30px rgba(220, 53, 69, 0.2), 0 0 15px rgba(0, 0, 0, 0.1)",
          }}
        >
          <div
            className="modal-header border-0 d-flex align-items-center"
            style={{
              backgroundColor: "#f8d7da",
              padding: "1.2rem 1.5rem",
            }}
          >
            <div className="d-flex align-items-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                fill="#dc3545"
                className="bi bi-exclamation-circle-fill me-3"
                viewBox="0 0 16 16"
              >
                <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4zm.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
              </svg>
              <h5
                className="modal-title text-danger fw-bold mb-0"
                style={{ fontSize: "1.25rem" }}
              >
                Error
              </h5>
            </div>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              style={{ fontSize: "0.7rem" }}
            ></button>
          </div>

          <div className="modal-body py-4 px-4">
            <div
              className="alert alert-danger mb-0 d-flex align-items-center"
              role="alert"
              style={{
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#fdf2f3",
                color: "#721c24",
                padding: "1rem 1.25rem",
                fontSize: "1rem",
                lineHeight: "1.5",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                fill="currentColor"
                className="bi bi-exclamation-triangle-fill flex-shrink-0 me-3"
                viewBox="0 0 16 16"
                style={{ minWidth: "20px" }}
              >
                <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
              </svg>
              <div>{message}</div>
            </div>
          </div>

          <div
            className="modal-footer border-0 pt-0"
            style={{ padding: "0 1.5rem 1.5rem 1.5rem" }}
          >
            <button
              type="button"
              className="btn px-4 py-2"
              onClick={onClose}
              style={{
                backgroundColor: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontWeight: "600",
                fontSize: "1rem",
                transition: "all 0.2s ease",
                minWidth: "100px",
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = "#bd2130";
                e.target.style.transform = "translateY(-2px)";
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = "#dc3545";
                e.target.style.transform = "translateY(0)";
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DangerAlertPopupMessage;
