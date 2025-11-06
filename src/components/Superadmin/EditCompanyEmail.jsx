import React, { useState } from "react";
import {
  Overlay,
  ModalContainer1,
  ModalTitle,
  CloseButton,
  ModalBtn,
  ButtonGroup,
} from "../Styles/DataRoomStyle.js";
import {
  IoCloseCircleOutline,
  IoMailOutline,
  IoCheckmarkCircle,
} from "react-icons/io5";
import axios from "axios";
import { API_BASE_URL } from "../../config/config";
const EditCompanyEmail = ({ CompanyId, currentEmail, onClose }) => {
  const [newEmail, setNewEmail] = useState(currentEmail || "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [dangerMessageReset, setdangerMessageReset] = useState("");
  const [errr, seterrr] = useState(false);
  const apiURL = API_BASE_URL + "api/user/company";
  const handleSaveEmail = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    setdangerMessageReset(""); // clear old message
    seterrr(false); // reset error state

    try {
      const response = await axios.post(apiURL + "/updateEmail", {
        email: newEmail,
        companyid: CompanyId,
      });

      // Extract response data
      const { status, message } = response.data;

      if (status === "2") {
        // ❌ Email already exists
        seterrr(true);
        setdangerMessageReset(message);
        setIsLoading(false);
      } else if (status === "1") {
        // ✅ Email updated successfully

        seterrr(false);
        setdangerMessageReset(message);
        setIsLoading(false);

        // Optionally close popup after a short delay
        setTimeout(() => {
          setdangerMessageReset("");
          window.location.reload();
          onClose();
        }, 1500);
      } else {
        // Unexpected response
        seterrr(true);
        setdangerMessageReset("Unexpected response from server.");
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Error updating email:", error);
      seterrr(true);
      setdangerMessageReset("Failed to update email. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <Overlay>
      <ModalContainer1 style={{ maxWidth: "480px", padding: "0" }}>
        {dangerMessageReset && (
          <div
            className={`flex items-center justify-between gap-3 shadow-lg ${
              errr ? "error_pop" : "success_pop"
            }`}
          >
            <div className="d-flex align-items-start gap-2">
              <span className="d-block">{dangerMessageReset}</span>
            </div>

            <button
              type="button"
              className="close_btnCros"
              onClick={() => setdangerMessageReset("")}
            >
              ×
            </button>
          </div>
        )}
        {/* Header Section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "24px 24px 20px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                backgroundColor: "#e3f2fd",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IoMailOutline size={20} style={{ color: "#1976d2" }} />
            </div>
            <ModalTitle
              style={{ margin: 0, fontSize: "20px", fontWeight: "600" }}
            >
              Edit Company Email
            </ModalTitle>
          </div>

          <CloseButton
            onClick={onClose}
            style={{ position: "relative", top: 0, right: 0 }}
          >
            <IoCloseCircleOutline size={28} />
          </CloseButton>
        </div>

        {/* Body Section */}
        <form onSubmit={handleSaveEmail}>
          <div style={{ padding: "24px" }}>
            {/* Current Email Display */}
            {currentEmail && (
              <div
                style={{
                  padding: "12px 16px",
                  backgroundColor: "#f8f9fa",
                  borderRadius: "8px",
                  marginBottom: "20px",
                }}
              >
                <p
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    color: "#6c757d",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    margin: "0 0 4px 0",
                  }}
                >
                  Current Email
                </p>
                <p
                  style={{
                    fontSize: "14px",
                    color: "#212529",
                    fontWeight: "500",
                    margin: 0,
                  }}
                >
                  {currentEmail}
                </p>
              </div>
            )}

            {/* New Email Input */}
            <div>
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#495057",
                  marginBottom: "8px",
                }}
              >
                New Email Address
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="email"
                  type="email"
                  name="newemail"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    setError("");
                  }}
                  placeholder="company@example.com"
                  required
                  disabled={isLoading}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    fontSize: "14px",
                    border: "1px solid #ced4da",
                    borderRadius: "8px",
                    outline: "none",
                    transition: "all 0.2s",
                    backgroundColor: isLoading ? "#f8f9fa" : "#fff",
                    cursor: isLoading ? "not-allowed" : "text",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#1976d2";
                    e.target.style.boxShadow =
                      "0 0 0 3px rgba(25, 118, 210, 0.1)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "#ced4da";
                    e.target.style.boxShadow = "none";
                  }}
                />
                {newEmail && newEmail !== currentEmail && (
                  <IoCheckmarkCircle
                    size={20}
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#28a745",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px 16px",
                  backgroundColor: "#fee",
                  border: "1px solid #fcc",
                  borderRadius: "8px",
                }}
              >
                <p
                  style={{
                    fontSize: "13px",
                    color: "#dc3545",
                    margin: 0,
                  }}
                >
                  {error}
                </p>
              </div>
            )}
          </div>

          {/* Footer Buttons */}
          <ButtonGroup
            style={{
              padding: "16px 24px 24px",
              gap: "12px",
            }}
          >
            <ModalBtn
              type="button"
              onClick={onClose}
              className="global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
              disabled={isLoading}
              style={{
                flex: 1,
                padding: "12px 20px",
                backgroundColor: "#f8f9fa",
                color: "#495057",
                border: "1px solid #dee2e6",
                borderRadius: "8px",
                fontWeight: "500",
                fontSize: "14px",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.6 : 1,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!isLoading) e.target.style.backgroundColor = "#e9ecef";
              }}
              onMouseLeave={(e) => {
                if (!isLoading) e.target.style.backgroundColor = "#f8f9fa";
              }}
            >
              Cancel
            </ModalBtn>
            <ModalBtn
              type="submit"
              disabled={isLoading || newEmail === currentEmail || !newEmail}
              className="global_btn px-4 py-2 fn_size_sm active d-flex align-items-center gap-2"
              style={{
                flex: 1,
                padding: "12px 20px",
                backgroundColor:
                  isLoading || newEmail === currentEmail || !newEmail
                    ? "#90caf9"
                    : "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontWeight: "500",
                fontSize: "14px",
                cursor:
                  isLoading || newEmail === currentEmail || !newEmail
                    ? "not-allowed"
                    : "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => {
                if (!isLoading && newEmail !== currentEmail && newEmail) {
                  e.target.style.backgroundColor = "#1565c0";
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading && newEmail !== currentEmail && newEmail) {
                  e.target.style.backgroundColor = "#1976d2";
                }
              }}
            >
              {isLoading ? (
                <>
                  <svg
                    style={{ animation: "spin 1s linear infinite" }}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      opacity="0.25"
                    />
                    <path
                      fill="currentColor"
                      opacity="0.75"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </ModalBtn>
          </ButtonGroup>
        </form>

        <style>{`
          @keyframes spin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </ModalContainer1>
    </Overlay>
  );
};

export default EditCompanyEmail;
