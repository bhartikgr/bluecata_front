import React, { useState, useEffect } from "react";
import {
  Overlay,
  ModalContainer,
  ModalTitle,
  CloseButton,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";
import { IoIosAdd } from "react-icons/io";

import { MdDeleteSweep } from "react-icons/md";
import axios from "axios";
import { Button } from "bootstrap";
import DataTable from "react-data-table-component";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import DangerAlert from "../../../components/Admin/DangerAlert";
const CompanyShareReferralCode = ({ onClose, returnrefresh }) => {
  const apiUrl = "http://localhost:5000/api/user/";
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [emails, setEmails] = useState([""]);
  const [spinners, setspinners] = useState(false);
  const [errr, seterrr] = useState(false);
  const [successresponse, setsuccessresponse] = useState("");
  const handleSubmit = async (e) => {
    e.preventDefault();
    const allEmails = Array.from(
      new Set([...emails.filter((e) => e.trim() !== "")])
    );

    let payload = {
      shared_by: "Company",
      discount_code: e.target.code.value,
      emails: allEmails,
      user_id: userLogin.id,
    };
    if (allEmails.length === 0) {
      setsuccessresponse("Please provide at least one email.");
      seterrr(true);
      setTimeout(() => {
        seterrr(false);
        setsuccessresponse("");
      }, 2000);
      return;
    }

    setspinners(true);
    try {
      const res = await axios.post(apiUrl + "checkReferralUser", payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setspinners(false);
      setsuccessresponse(res.data.message);
      if (res.data.status === "2") {
        seterrr(true);
      }
      if (res.data.status === "1") {
        setEmails([""]);
        seterrr(false);
        setTimeout(() => { }, 2000);
        returnrefresh();
        e.target.code.value = "";
      }

      setTimeout(() => {
        setsuccessresponse("");
      }, 2000);
    } catch (err) {
      console.error("Submit error:", err);
    }
  };
  const handleEmailChange = (index, value) => {
    const updated = [...emails];
    updated[index] = value;
    setEmails(updated);
  };
  const handleRemoveEmail = (index) => {
    const updated = emails.filter((_, i) => i !== index);
    setEmails(updated);
  };
  const handleAddMoreEmail = () => {
    setEmails([...emails, ""]);
  };
  return (
    <div className="main_popup-overlay">
      <ModalContainer
        style={{
          maxWidth: "900px",
          maxHeight: "550px",
          borderRadius: "12px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          padding: "0px",
        }}
      >
        <form
          onSubmit={handleSubmit}
          method="post"
          action="javascript:void(0)"
          style={{ height: "100%", display: "flex", flexDirection: "column" }}
        >
          {/* Modal Header */}
          <div
            style={{
              borderBottom: "1px solid #e9ecef",
              backgroundColor: "#f8f9fa",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <ModalTitle
              className="mainh1"
              style={{
                margin: 0,
                color: "#2d3748",
                padding: "20px",
              }}
            >
              Share Referral Code
            </ModalTitle>
            <CloseButton
              onClick={onClose}
              style={{
                fontSize: "1.5rem",
                fontWeight: "300",
                color: "#6c757d",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0.25rem 0.5rem",
                borderRadius: "4px",
                transition: "all 0.2s ease",
              }}
              onMouseOver={(e) => (e.target.style.color = "#495057")}
              onMouseOut={(e) => (e.target.style.color = "#6c757d")}
            >
              ×
            </CloseButton>
          </div>

          {/* Modal Body - Scrollable Content */}
          <div
            style={{
              padding: "1.5rem",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {successresponse && (
              <div
                className={`alert ${errr ? "alert-danger" : "alert-success"
                  } mb-4`}
                style={{ borderRadius: "8px", flexShrink: 0 }}
              >
                {successresponse}
              </div>
            )}

            {/* Code Input */}
            <div
              className="mb-4 d-flex flex-column gap-2"
              style={{ flexShrink: 0 }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: "0.9rem",
                  fontWeight: "500",
                  color: "#374151",
                }}
              >
                Code <span style={{ color: "var(--primary)" }}>*</span>
              </label>
              <div className="form-group">
                <input
                  type="text"
                  required
                  name="code"
                  className="textarea_input"
                  placeholder="Enter referral code..."
                  style={{
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    fontSize: "1rem",
                    transition: "all 0.2s ease",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "#0d6efd")}
                  onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
                />
              </div>
            </div>

            {/* Email Inputs Header */}
            <div className="d-flex flex-column gap-2">
              <div style={{ flexShrink: 0 }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: "500",
                    color: "#374151",
                    fontSize: "0.9rem",
                  }}
                >
                  Email Addresses{" "}
                  <span style={{ color: "var(--primary)" }}>*</span>
                </label>
              </div>

              {/* Scrollable Email List Container */}
              <div
                style={{
                  flex: 1,
                  maxHeight: "150px", // 👈 limit height for scroll area
                  overflowY: "auto", // 👈 enable vertical scrolling
                  marginBottom: "0.5rem",
                  paddingRight: "0.5rem",
                }}
                className="custom-scrollbar"
              >
                {emails.map((email, index) => (
                  <div
                    key={index}
                    className="form-group mb-3 d-flex gap-2 align-items-start"
                  >
                    <div style={{ position: "relative", flex: 1 }}>
                      <input
                        type="email"
                        required
                        className="textarea_input"
                        placeholder="Enter email address..."
                        value={email}
                        onChange={(e) =>
                          handleEmailChange(index, e.target.value)
                        }
                        style={{
                          padding: "0.75rem 1rem",
                          borderRadius: "8px",
                          border: "1px solid #e2e8f0",
                          fontSize: "1rem",
                          transition: "all 0.2s ease",
                        }}
                        onFocus={(e) =>
                          (e.target.style.borderColor = "#0d6efd")
                        }
                        onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
                      />
                    </div>
                    {index > 0 && (
                      <button
                        type="button"
                        style={{
                          color: "rgb(255 61 65)",
                          background: "#fff",
                          width: "50x",
                          border: "none",
                          fontSize: "23px",
                        }}
                        onClick={() => handleRemoveEmail(index)}
                      >
                        <MdDeleteSweep />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div
            style={{
              padding: "1.25rem 1.5rem",
              borderTop: "1px solid #e9ecef",
              backgroundColor: "#f8f9fa",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              className="close_btn w-fit d-flex align-items-center gap-3"
              onClick={handleAddMoreEmail}
            >
              <span>
                <IoIosAdd width={20} />
              </span>
              <span>Add More Email</span>
            </button>

            <div className="d-flex gap-2">
              <button
                type="button"
                className="close_btn w-fit"
                onClick={onClose}
              >
                Cancel
              </button>

              <ModalBtn
                disabled={spinners}
                variant="upload"
                type="submit"
                className="global_btn w-fit"
              >
                Submit
                {spinners && (
                  <div
                    className="white-spinner spinner-border spinneronetimepay m-0"
                    role="status"
                    style={{ width: "1rem", height: "1rem" }}
                  >
                    <span className="visually-hidden"></span>
                  </div>
                )}
              </ModalBtn>
            </div>
          </div>
        </form>

        {/* Custom Scrollbar Styles */}
        <style>
          {`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #c1c1c1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #a8a8a8;
        }
      `}
        </style>
      </ModalContainer>
    </div>
  );
};

export default CompanyShareReferralCode;
