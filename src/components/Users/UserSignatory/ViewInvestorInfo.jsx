import React from "react";
import { VscOpenPreview } from "react-icons/vsc";
import {
  FaDownload,
  FaCalendar,
  FaUser,
  FaBuilding,
  FaLock,
  FaShare,
  FaPhone,
  FaMapMarkerAlt,
  FaGlobe,
  FaFileAlt,
  FaLink,
} from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import { MdDescription, MdEmail, MdSecurity } from "react-icons/md";

const ViewInvestorInfo = ({ onClose, recordViewData }) => {
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

  // Safe data access with fallbacks
  const investor = recordViewData || {};
  console.log(investor);
  return (
    <div
      className="main_popup-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1050,
        padding: "20px",
      }}
    >
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
        <div className="p-4 border-bottom bg-light d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center">
            <div
              style={{ width: "50px", height: "50px" }}
              className="bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 rounded-circle me-3"
            >
              <VscOpenPreview size={24} className="text-success" />
            </div>
            <div>
              <h4 className="mb-0 fw-bold text-dark">Investor Details</h4>
              <p className="mb-0 text-muted">Complete investor information</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-light rounded-circle p-2"
            style={{ width: "40px", height: "40px" }}
          >
            <IoCloseCircleOutline size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          <div className="row g-4">
            {/* Personal Information */}
            <div className="col-12 col-md-6">
              <div className="card h-100 border-0 shadow-sm">
                <div className="card-header bg-transparent border-bottom py-3">
                  <h6 className="mb-0 fw-bold d-flex align-items-center">
                    <FaUser className="me-2 text-primary" />
                    Personal Information
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Full Name
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.first_name || "N/A"}{" "}
                        {investor.last_name || ""}
                      </p>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1 d-flex align-items-center">
                        <MdEmail className="me-1" />
                        Email Address
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.email || "N/A"}
                      </p>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1 d-flex align-items-center">
                        <FaPhone className="me-1" />
                        Phone Number
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.phone || "N/A"}
                      </p>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Investor Type
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.type_of_investor || "N/A"}
                      </p>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Accredited Status
                      </label>
                      <span
                        className={`badge ${investor.accredited_status === "Yes"
                          ? "bg-success"
                          : "bg-warning"
                          }`}
                      >
                        {investor.accredited_status || "Not Specified"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Location Information */}
            <div className="col-12 col-md-6">
              <div className="card h-100 border-0 shadow-sm">
                <div className="card-header bg-transparent border-bottom py-3">
                  <h6 className="mb-0 fw-bold d-flex align-items-center">
                    <FaMapMarkerAlt className="me-2 text-primary" />
                    Location Details
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        City
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.city || "N/A"}
                      </p>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Country
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.country || "N/A"}
                      </p>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Full Address
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.full_address || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tax Information */}
            <div className="col-12 col-md-6">
              <div className="card h-100 border-0 shadow-sm">
                <div className="card-header bg-transparent border-bottom py-3">
                  <h6 className="mb-0 fw-bold d-flex align-items-center">
                    <FaBuilding className="me-2 text-primary" />
                    Tax Information
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Tax Country
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.country_tax || "N/A"}
                      </p>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Tax ID
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.tax_id || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Professional Information */}
            <div className="col-12 col-md-6">
              <div className="card h-100 border-0 shadow-sm">
                <div className="card-header bg-transparent border-bottom py-3">
                  <h6 className="mb-0 fw-bold d-flex align-items-center">
                    <FaGlobe className="me-2 text-primary" />
                    Professional Details
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1 d-flex align-items-center">
                        <FaLink className="me-1" />
                        LinkedIn Profile
                      </label>
                      {investor.linkedIn_profile ? (
                        <a
                          href={investor.linkedIn_profile}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary text-decoration-none"
                        >
                          View Profile
                        </a>
                      ) : (
                        <p className="mb-0 fw-semibold">N/A</p>
                      )}
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Industry Expertise
                      </label>
                      {investor.industry_expertise ? (
                        <div className="d-flex flex-wrap gap-1">
                          {investor.industry_expertise
                            .split(",")
                            .map((industry, index) => (
                              <span
                                key={index}
                                className="badge bg-light text-dark border"
                              >
                                {industry.trim()}
                              </span>
                            ))}
                        </div>
                      ) : (
                        <p className="mb-0 fw-semibold">N/A</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Security & Documents */}
            <div className="col-12 col-md-6">
              <div className="card h-100 border-0 shadow-sm">
                <div className="card-header bg-transparent border-bottom py-3">
                  <h6 className="mb-0 fw-bold d-flex align-items-center">
                    <MdSecurity className="me-2 text-primary" />
                    Security & Documents
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Registration Status
                      </label>
                      <span
                        className={`badge ${investor.is_register === "Yes"
                          ? "bg-success"
                          : "bg-secondary"
                          }`}
                      >
                        {investor.is_register || "No"}
                      </span>
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        KYC Document
                      </label>
                      {(() => {
                        // Parse and process KYC documents
                        let documents = [];

                        try {
                          if (
                            investor.kyc_document &&
                            investor.kyc_document !== "null" &&
                            investor.kyc_document !== "[]"
                          ) {
                            const parsed = JSON.parse(investor.kyc_document);
                            documents = Array.isArray(parsed)
                              ? parsed
                              : [parsed];
                          }
                        } catch (error) {
                          console.error("Error parsing KYC document:", error);
                        }

                        // Filter valid documents
                        const validDocuments = documents.filter(
                          (doc) => doc && doc.trim() !== "" && doc !== "null"
                        );

                        if (validDocuments.length === 0) {
                          return (
                            <div className="text-center py-3 border rounded">
                              <FaFileAlt
                                size={24}
                                className="text-muted mb-2"
                              />
                              <p className="mb-0 fw-semibold text-muted">
                                No Document Available
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="d-flex flex-column gap-2">
                            {validDocuments.map((document, index) => {
                              const fileName = document.includes("/")
                                ? document.split("/").pop()
                                : document;
                              const documentUrl = `http://localhost:5000/api/upload/investor/inv_${investor.id
                                }/${encodeURIComponent(document)}`;

                              return (
                                <div
                                  key={index}
                                  className="d-flex align-items-center justify-content-between p-2 border rounded"
                                >
                                  <div className="d-flex align-items-center gap-2">
                                    <FaFileAlt className="text-muted" />
                                    <div>
                                      <div
                                        className="fw-semibold small text-truncate"
                                        style={{ maxWidth: "200px" }}
                                      >
                                        {fileName}
                                      </div>
                                      <div
                                        className="text-muted"
                                        style={{ fontSize: "0.7rem" }}
                                      >
                                        KYC Document {index + 1}
                                      </div>
                                    </div>
                                  </div>
                                  <a
                                    href={documentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                                    download={fileName}
                                  >
                                    <FaDownload size={12} />
                                    View
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        IP Address
                      </label>
                      <p className="mb-0 fw-semibold">
                        {investor.ip_address || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* System Information */}
            <div className="col-12 col-md-6">
              <div className="card h-100 border-0 shadow-sm">
                <div className="card-header bg-transparent border-bottom py-3">
                  <h6 className="mb-0 fw-bold d-flex align-items-center">
                    <FaCalendar className="me-2 text-primary" />
                    System Information
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label text-muted small mb-1">
                        Created At
                      </label>
                      <p className="mb-0 fw-semibold">
                        {formatDate(investor.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer with Buttons */}
        <div className="p-3 border-top bg-light d-flex justify-content-between align-items-center">
          <div>
            <span className="text-muted small">
              Investor ID: <strong>{investor.id || "N/A"}</strong>
            </span>
          </div>
          <div className="d-flex justify-content-end gap-2">
            <button
              onClick={onClose}
              className="btn btn-secondary px-4"
              style={{ minWidth: "100px" }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViewInvestorInfo;
