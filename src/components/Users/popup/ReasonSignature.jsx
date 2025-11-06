import { FaTrash } from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  ModalContainer,
  CloseButton,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";
import { useState } from "react";
import axios from "axios";
const ReasonSignature = ({
  onClose,
  ViewData,
  onSubmitReason,
  refreshpage,
}) => {
  const [reason, setReason] = useState("");
  const storedUsername = localStorage.getItem("OwnerLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [errr, seterrr] = useState(false);
  const [messagesuccessError, setmessagesuccessError] = useState("");
  const capitalizeFirstLetter = (str) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  };
  var apiURL = "http://localhost:5000/api/user/";
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!reason.trim()) {
      alert("Please enter a reason before submitting.");
      return;
    }

    const formData = {
      id: ViewData.id,
      reason: reason,
    };
    try {
      const resp = await axios.post(apiURL + "declineSignature", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setmessagesuccessError(resp.data.message);
      refreshpage();
      setTimeout(() => {
        onClose();
      }, 2500);
    } catch (err) {
      console.error("Error generating summary", err);
    }
    // Close modal after submit
  };
  if (!ViewData) return null; // safety check
  return (
    <div className="main_popup-overlay">
      <ModalContainer>
        <CloseButton onClick={onClose}>×</CloseButton>
        {messagesuccessError && (
          <div
            className={`flex items-center justify-between gap-3 shadow-lg ${errr ? "error_pop" : "success_pop"
              }`}
          >
            <div className="d-flex align-items-center gap-2">
              <span className="d-block">{messagesuccessError}</span>
            </div>

            <button
              type="button"
              className="close_btnCros"
              onClick={() => setmessagesuccessError("")}
            >
              ×
            </button>
          </div>
        )}
        <div className="previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm">
          <div className="d-flex align-items-center mb-3 pb-2 border-bottom">
            <div
              style={{ width: "45px", height: "45px" }}
              className="bg-danger d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 p-1 rounded-circle me-3"
            >
              <FaTrash />
            </div>
            <div className="d-flex align-items-center justify-content-between gap-3 w-100">
              <h3 className="mb-0 fw-semibold text-dark">Decline Reason</h3>
              <button
                type="button"
                className="bg-transparent text-danger p-1 border-0"
                onClick={onClose}
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>
          </div>

          <div className="row g-3">
            {/* Signature Type */}

            {/* Signature Preview */}
            <div className="col-md-12">
              <div className="p-3 bg-light rounded-3 h-100 text-center">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Signature:
                </span>
                <div className="mt-2">
                  {ViewData.type === "upload" && (
                    <img
                      src={`http://localhost:5000/upload/docs/doc_${ViewData.company_id}/signatory/${ViewData.signature}`}
                      alt="Uploaded Signature"
                      style={{ maxWidth: "300px" }}
                    />
                  )}

                  {ViewData.type === "manual" && (
                    <div
                      dangerouslySetInnerHTML={{ __html: ViewData.signature }}
                      style={{
                        border: "1px solid #ced4da",
                        padding: "10px",
                        minHeight: "120px",
                        background: "#fff",
                      }}
                    />
                  )}

                  {ViewData.type === "pad" && (
                    <img
                      src={ViewData.signature} // base64
                      alt="Signature Pad"
                      style={{ maxWidth: "300px" }}
                    />
                  )}

                  {!ViewData.signature && (
                    <p className="text-muted">No signature available</p>
                  )}
                </div>
              </div>
            </div>

            {/* Decline Reason Form */}
            <div className="col-md-12">
              <form onSubmit={handleSubmit} method="post">
                <label className="fw-semibold text-dark mb-2">
                  Decline Reason: <span className="text-danger">*</span>
                </label>
                <textarea
                  className="form-control"
                  rows="3"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter reason for declining this signature"
                  required
                />
                <ButtonGroup className="d-flex gap-2 mt-3">
                  <button type="submit" className="btn btn-danger">
                    Submit Reason
                  </button>
                  <ModalBtn
                    type="button"
                    onClick={onClose}
                    className="close_btn w-fit"
                  >
                    Cancel
                  </ModalBtn>
                </ButtonGroup>
              </form>
            </div>
          </div>
        </div>
      </ModalContainer>
    </div>
  );
};

export default ReasonSignature;
