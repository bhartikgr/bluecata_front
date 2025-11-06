import React from "react";
import { VscOpenPreview } from "react-icons/vsc";
import {
  FaDownload,
  FaCalendar,
  FaUser,
  FaBuilding,
  FaLock,
  FaShare,
} from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import { MdDescription } from "react-icons/md";

const ViewInvestorReport = ({ onClose, recordViewData }) => {
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const handleDownload = (url) => {
    if (!url) {
      console.error("No download URL provided");
      return;
    }

    // Create a temporary anchor element
    const link = document.createElement("a");
    link.href = url;
    link.download = ""; // This will use the filename from the URL
    link.target = "_blank"; // Open in new tab as fallback

    // Trigger the download
    document.body.appendChild(link);
    link.click();

    // Clean up
    document.body.removeChild(link);
  };
  function formatCurrentDate(input) {
    if (!input) return "N/A";
    const date = new Date(input);

    if (isNaN(date)) return "N/A";

    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    const getOrdinal = (n) => {
      if (n >= 11 && n <= 13) return "th";
      switch (n % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    };

    return `${month} ${day}${getOrdinal(day)}, ${year}`;
  }
  return (
    <div className="main_popup-overlay">
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          width: "95%",
          maxWidth: "1200px",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.2)",
          margin: "20px auto",
        }}
      >
        {/* Header */}
        <div className="p-4 border-bottom bg-light">
          <div className="d-flex align-items-center">
            <div
              style={{ width: "50px", height: "50px" }}
              className="bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 rounded-circle me-3"
            >
              <VscOpenPreview size={24} className="text-success" />
            </div>
            <div className="d-flex align-items-center justify-content-between gap-3 w-100">
              <div>
                <h3 className="mb-1 fw-bold text-dark">
                  {recordViewData?.document_name || "Investor Report"}
                </h3>
                <small className="text-muted">
                  Document ID: #{recordViewData?.id}
                  <br />
                  Create Date: {formatCurrentDate(recordViewData.created_at)}
                </small>
              </div>
              <button
                type="button"
                className="bg-transparent text-danger border-0 p-0"
                onClick={onClose}
                style={{ cursor: "pointer" }}
              >
                <IoCloseCircleOutline size={28} />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          {/* Basic Information */}
          <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
            <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
              <MdDescription className="me-2" />
              Basic Information
            </h5>

            <div className="row g-3">
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Document Type</label>
                  <div className="fw-semibold">
                    {recordViewData?.type || "N/A"}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Version</label>
                  <div className="fw-semibold">
                    {recordViewData?.version || "N/A"}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Company ID</label>
                  <div className="fw-semibold">
                    {recordViewData?.company_id || "N/A"}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Created By</label>
                  <div className="fw-semibold">
                    ID: {recordViewData?.created_by_id || "N/A"}
                    <span className="ms-2 badge bg-info">
                      {recordViewData?.created_by_role || "N/A"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Update Date</label>
                  <div className="fw-semibold">
                    {formatDate(recordViewData?.update_date)}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Status</label>
                  <div>
                    <span
                      className={`badge me-2 ${
                        recordViewData?.is_locked ? "bg-danger" : "bg-success"
                      }`}
                    >
                      <FaLock className="me-1" size={12} />
                      {recordViewData?.is_locked ? "Locked" : "Unlocked"}
                    </span>
                    <span
                      className={`badge ${
                        recordViewData?.is_shared === "Yes"
                          ? "bg-info"
                          : "bg-secondary"
                      }`}
                    >
                      <FaShare className="me-1" size={12} />
                      {recordViewData?.is_shared === "Yes"
                        ? "Shared"
                        : "Not Shared"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Created At</label>
                  <div className="fw-semibold">
                    {formatDate(recordViewData?.created_at)}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="text-muted small mb-1">Updated At</label>
                  <div className="fw-semibold">
                    {formatDate(recordViewData?.updated_at)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Executive Summary */}
          {recordViewData?.executive_summary && (
            <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
              <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                Executive Summary
              </h5>
              <div
                className="p-3 bg-light border rounded-3"
                style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
              >
                {recordViewData.executive_summary}
              </div>
            </div>
          )}
          {recordViewData.type === "Investor updates" && (
            <>
              {/* Financial Performance */}
              {recordViewData?.financial_performance && (
                <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
                  <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                    💰 Financial Performance
                  </h5>
                  <div
                    className="p-3 bg-light border rounded-3"
                    style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
                  >
                    {recordViewData.financial_performance}
                  </div>
                </div>
              )}

              {/* Operational Updates */}
              {recordViewData?.operational_updates && (
                <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
                  <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                    ⚙️ Operational Updates
                  </h5>
                  <div
                    className="p-3 bg-light border rounded-3"
                    style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
                  >
                    {recordViewData.operational_updates}
                  </div>
                </div>
              )}

              {/* Market & Competitive Analysis */}
              {recordViewData?.market_competitive && (
                <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
                  <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                    📊 Market & Competitive Analysis
                  </h5>
                  <div
                    className="p-3 bg-light border rounded-3"
                    style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
                  >
                    {recordViewData.market_competitive}
                  </div>
                </div>
              )}

              {/* Customer & Product Updates */}
              {recordViewData?.customer_product && (
                <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
                  <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                    👥 Customer & Product Updates
                  </h5>
                  <div
                    className="p-3 bg-light border rounded-3"
                    style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
                  >
                    {recordViewData.customer_product}
                  </div>
                </div>
              )}

              {/* Fundraising & Financial Status */}
              {recordViewData?.fundraising_financial && (
                <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
                  <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                    💵 Fundraising & Financial Status
                  </h5>
                  <div
                    className="p-3 bg-light border rounded-3"
                    style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
                  >
                    {recordViewData.fundraising_financial}
                  </div>
                </div>
              )}

              {/* Future Outlook */}
              {recordViewData?.future_outlook && (
                <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
                  <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                    🔮 Future Outlook
                  </h5>
                  <div
                    className="p-3 bg-light border rounded-3"
                    style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
                  >
                    {recordViewData.future_outlook}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer with Buttons */}
        <div className="p-3 border-top bg-light d-flex justify-content-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-secondary px-4"
            style={{ minWidth: "100px" }}
          >
            Close
          </button>
          {recordViewData?.downloadUrl && (
            <button
              onClick={() => handleDownload(recordViewData.downloadUrl)}
              className="btn btn-primary px-4 d-flex align-items-center gap-2"
            >
              <FaDownload size={14} />
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ViewInvestorReport;
