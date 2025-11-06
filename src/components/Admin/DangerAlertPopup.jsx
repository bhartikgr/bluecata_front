import React, { useEffect, useRef } from "react";

function DangerAlertPopup({ message, onConfirm, onCancel }) {
  const modalRef = useRef(null);
  const confirmButtonRef = useRef(null);

  // Handle escape key and focus management
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };

    document.addEventListener("keydown", handleKeyDown);
    confirmButtonRef.current.focus();

    // Prevent body scrolling when modal is open
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [onConfirm, onCancel]);

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        opacity: 0,
        animation: "fadeIn 0.3s ease-out forwards",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      <div
        ref={modalRef}
        className="modal-content"
        style={{
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "12px",
          boxShadow:
            "0 10px 30px rgba(0, 0, 0, 0.15), 0 0 10px rgba(220, 53, 69, 0.2)",
          maxWidth: "450px",
          width: "90%",
          transform: "scale(0.9) translateY(-20px)",
          animation: "scaleIn 0.3s ease-out forwards",
          border: "1px solid rgba(220, 53, 69, 0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="modal-icon"
          style={{
            textAlign: "center",
            marginBottom: "1.5rem",
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ color: "#dc3545" }}
          >
            <path
              d="M12 9V14M12 17V17.01M5.07183 19H18.9282C20.4678 19 21.4301 17.3333 20.6603 16L13.7321 4C12.9623 2.66667 11.0378 2.66667 10.268 4L3.33978 16C2.56998 17.3333 3.53223 19 5.07183 19Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h3
          className="modal-title"
          style={{
            textAlign: "center",
            margin: "0 0 1rem 0",
            color: "#dc3545",
            fontSize: "1.5rem",
            fontWeight: "600",
          }}
        >
          Confirm Action
        </h3>

        <p
          className="modal-message"
          style={{
            textAlign: "center",
            margin: "0 0 2rem 0",
            color: "#495057",
            fontSize: "1rem",
            lineHeight: "1.5",
          }}
        >
          {message}
        </p>

        <div
          className="modal-actions"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
          }}
        >
          <button
            type="button"
            className="btn-cancel"
            onClick={onCancel}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#f8f9fa",
              color: "#495057",
              border: "1px solid #dee2e6",
              borderRadius: "6px",
              fontWeight: "500",
              fontSize: "1rem",
              cursor: "pointer",
              transition: "all 0.2s ease",
              minWidth: "100px",
            }}
            onMouseOver={(e) => {
              e.target.style.backgroundColor = "#e9ecef";
              e.target.style.transform = "translateY(-2px)";
            }}
            onMouseOut={(e) => {
              e.target.style.backgroundColor = "#f8f9fa";
              e.target.style.transform = "translateY(0)";
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-confirm"
            ref={confirmButtonRef}
            onClick={onConfirm}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontWeight: "500",
              fontSize: "1rem",
              cursor: "pointer",
              transition: "all 0.2s ease",
              minWidth: "100px",
              boxShadow: "0 4px 6px rgba(220, 53, 69, 0.3)",
            }}
            onMouseOver={(e) => {
              e.target.style.backgroundColor = "#bd2130";
              e.target.style.transform = "translateY(-2px)";
              e.target.style.boxShadow = "0 6px 8px rgba(220, 53, 69, 0.4)";
            }}
            onMouseOut={(e) => {
              e.target.style.backgroundColor = "#dc3545";
              e.target.style.transform = "translateY(0)";
              e.target.style.boxShadow = "0 4px 6px rgba(220, 53, 69, 0.3)";
            }}
          >
            Confirm
          </button>
        </div>
      </div>

      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          
          @keyframes scaleIn {
            from { 
              transform: scale(0.9) translateY(-20px);
              opacity: 0;
            }
            to { 
              transform: scale(1) translateY(0);
              opacity: 1;
            }
          }
          
          .btn-cancel:focus, .btn-confirm:focus {
            outline: 2px solid #3d8bfd;
            outline-offset: 2px;
          }
        `}
      </style>
    </div>
  );
}

export default DangerAlertPopup;
