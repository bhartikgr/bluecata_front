import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  FaTimes,
  FaCalendar,
  FaFileAlt,
  FaLock,
  FaUnlock,
  FaShare,
  FaUsers,
} from "react-icons/fa";
import { Building2, User } from "lucide-react";

function AdminCompanyInvestorReporting({ ReportId, onClose }) {
  const [ReportDetails, setReportDetails] = useState(null);
  const [ReportDetailsInvestor, setReportDetailsInvestor] = useState([]);
  const apiUrl = "http://localhost:5000/api/admin/company/";

  useEffect(() => {
    if (ReportId) totalDocs();
  }, [ReportId]);

  const totalDocs = async () => {
    let formData = { ReportId: ReportId };

    try {
      const res = await axios.post(apiUrl + "getCompanyReport", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const respo = res.data.results;

      setReportDetails(respo);
      setReportDetailsInvestor(res.data.sharedInvestors);
    } catch (err) {
      console.error("Error fetching company data:", err);
    }
  };
  function formatCurrentDate(input) {
    const date = new Date(input);

    if (isNaN(date)) return "";
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
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        className="modal-content"
        style={{
          background: "white",
          borderRadius: "12px",
          padding: "0",
          width: "1000px",
          maxWidth: "90%",
          maxHeight: "99vh",
          position: "relative",
          boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "20px",
            right: "20px",
            border: "none",
            background: "rgba(255, 255, 255, 0.9)",
            cursor: "pointer",
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            zIndex: 10,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fee2e2";
            e.currentTarget.style.color = "#dc2626";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.9)";
            e.currentTarget.style.color = "#000";
          }}
        >
          <FaTimes size={18} />
        </button>
        {/* Modal Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            padding: "1.5rem",
            borderRadius: "12px 12px 0 0",
          }}
        >
          <div className="d-flex align-items-center gap-3">
            <div
              style={{
                width: "48px",
                height: "48px",
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FaFileAlt style={{ fontSize: "24px" }} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.5rem", fontWeight: "600" }}>
                {ReportDetails?.type || "Report Details"}
              </h3>
              <p
                style={{
                  margin: "4px 0 0 0",
                  opacity: 0.9,
                  fontSize: "0.9rem",
                }}
              >
                {ReportDetails?.document_name || "Document Report"}
              </p>
            </div>
          </div>
        </div>
        {/* Modal Body */}
        <div
          style={{
            padding: "2rem",
            maxHeight: "calc(90vh - 220px)",
            overflowY: "auto",
          }}
        >
          {ReportDetails ? (
            <>
              {/* Basic Information */}
              <div
                style={{
                  background: "#f9fafb",
                  padding: "1.5rem",
                  borderRadius: "8px",
                  marginBottom: "1.5rem",
                }}
              >
                <h5
                  style={{
                    fontSize: "1rem",
                    fontWeight: "600",
                    marginBottom: "1rem",
                    color: "#374151",
                  }}
                >
                  Basic Information
                </h5>
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <div className="d-flex align-items-center gap-2">
                      <FaFileAlt style={{ color: "#667eea" }} />
                      <div>
                        <small style={{ color: "#6b7280", display: "block" }}>
                          Version
                        </small>
                        <strong style={{ color: "#111827" }}>
                          {ReportDetails.version || "-"}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6 mb-3">
                    <div className="d-flex align-items-center gap-2">
                      <FaCalendar style={{ color: "#667eea" }} />
                      <div>
                        <small style={{ color: "#6b7280", display: "block" }}>
                          Date of Report
                        </small>
                        <strong style={{ color: "#111827" }}>
                          {ReportDetails.update_date
                            ? formatCurrentDate(ReportDetails.update_date)
                            : "-"}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6 mb-3">
                    <div className="d-flex align-items-center gap-2">
                      {ReportDetails.is_locked ? (
                        <FaLock style={{ color: "#ef4444" }} />
                      ) : (
                        <FaUnlock style={{ color: "#10b981" }} />
                      )}
                      <div>
                        <small style={{ color: "#6b7280", display: "block" }}>
                          Status
                        </small>
                        <strong
                          style={{
                            color: ReportDetails.is_locked
                              ? "#ef4444"
                              : "#10b981",
                          }}
                        >
                          {ReportDetails.is_locked ? "Locked" : "Unlocked"}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6 mb-3">
                    <div className="d-flex align-items-center gap-2">
                      <FaShare style={{ color: "#667eea" }} />
                      <div>
                        <small style={{ color: "#6b7280", display: "block" }}>
                          Shared
                        </small>
                        <strong
                          style={{
                            color:
                              ReportDetails.is_shared === "Yes"
                                ? "#10b981"
                                : "#6b7280",
                          }}
                        >
                          {ReportDetails.is_shared || "No"}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6 mb-3">
                    <div className="d-flex align-items-center gap-2">
                      <FaUsers style={{ color: "#667eea" }} />
                      <div>
                        <small style={{ color: "#6b7280", display: "block" }}>
                          Total Investor Shared
                        </small>
                        <strong>{ReportDetails.total_shares}</strong>
                      </div>
                    </div>
                  </div>
                  {ReportDetails.downloadUrl && (
                    <div
                      style={{
                        background: "#f0f9ff",
                        padding: "1rem",
                        borderRadius: "8px",
                        marginBottom: "1.5rem",
                        border: "1px solid #bae6fd",
                      }}
                    >
                      <div className="d-flex align-items-center justify-content-between">
                        <div className="d-flex align-items-center gap-2">
                          <FaFileAlt
                            style={{ color: "#0284c7", fontSize: "1.25rem" }}
                          />
                          <div>
                            <strong
                              style={{ color: "#0c4a6e", display: "block" }}
                            >
                              Document Available
                            </strong>
                            <small style={{ color: "#0369a1" }}>
                              {ReportDetails.document_name}
                            </small>
                          </div>
                        </div>

                        <a // This was the missing part
                          href={ReportDetails.downloadUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "0.5rem 1.25rem",
                            borderRadius: "8px",
                            border: "none",
                            background: "#0284c7",
                            color: "white",
                            cursor: "pointer",
                            fontWeight: "500",
                            fontSize: "0.875rem",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            transition: "all 0.2s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "#0369a1";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "#0284c7";
                          }}
                        >
                          <FaFileAlt />
                          Download Report
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Conditional Content - Only for Investor Updates */}
              {ReportDetails.type === "Investor updates" && (
                <>
                  {/* Executive Summary */}
                  {ReportDetails.executive_summary && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h5
                        style={{
                          fontSize: "1rem",
                          fontWeight: "600",
                          marginBottom: "0.75rem",
                          color: "#374151",
                          borderLeft: "4px solid #667eea",
                          paddingLeft: "0.75rem",
                        }}
                      >
                        Executive Summary
                      </h5>
                      <p
                        style={{
                          color: "#4b5563",
                          lineHeight: "1.6",
                          margin: 0,
                          padding: "1rem",
                          background: "#f9fafb",
                          borderRadius: "8px",
                        }}
                      >
                        {ReportDetails.executive_summary}
                      </p>
                    </div>
                  )}

                  {/* Financial Performance */}
                  {ReportDetails.financial_performance && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h5
                        style={{
                          fontSize: "1rem",
                          fontWeight: "600",
                          marginBottom: "0.75rem",
                          color: "#374151",
                          borderLeft: "4px solid #10b981",
                          paddingLeft: "0.75rem",
                        }}
                      >
                        Financial Performance
                      </h5>
                      <p
                        style={{
                          color: "#4b5563",
                          lineHeight: "1.6",
                          margin: 0,
                          padding: "1rem",
                          background: "#f9fafb",
                          borderRadius: "8px",
                        }}
                      >
                        {ReportDetails.financial_performance}
                      </p>
                    </div>
                  )}

                  {/* Operational Updates */}
                  {ReportDetails.operational_updates && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h5
                        style={{
                          fontSize: "1rem",
                          fontWeight: "600",
                          marginBottom: "0.75rem",
                          color: "#374151",
                          borderLeft: "4px solid #3b82f6",
                          paddingLeft: "0.75rem",
                        }}
                      >
                        Operational Updates
                      </h5>
                      <p
                        style={{
                          color: "#4b5563",
                          lineHeight: "1.6",
                          margin: 0,
                          padding: "1rem",
                          background: "#f9fafb",
                          borderRadius: "8px",
                        }}
                      >
                        {ReportDetails.operational_updates}
                      </p>
                    </div>
                  )}

                  {/* Market & Competitive */}
                  {ReportDetails.market_competitive && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h5
                        style={{
                          fontSize: "1rem",
                          fontWeight: "600",
                          marginBottom: "0.75rem",
                          color: "#374151",
                          borderLeft: "4px solid #f59e0b",
                          paddingLeft: "0.75rem",
                        }}
                      >
                        Market & Competitive Analysis
                      </h5>
                      <p
                        style={{
                          color: "#4b5563",
                          lineHeight: "1.6",
                          margin: 0,
                          padding: "1rem",
                          background: "#f9fafb",
                          borderRadius: "8px",
                        }}
                      >
                        {ReportDetails.market_competitive}
                      </p>
                    </div>
                  )}

                  {/* Customer & Product */}
                  {ReportDetails.customer_product && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h5
                        style={{
                          fontSize: "1rem",
                          fontWeight: "600",
                          marginBottom: "0.75rem",
                          color: "#374151",
                          borderLeft: "4px solid #8b5cf6",
                          paddingLeft: "0.75rem",
                        }}
                      >
                        Customer & Product Updates
                      </h5>
                      <p
                        style={{
                          color: "#4b5563",
                          lineHeight: "1.6",
                          margin: 0,
                          padding: "1rem",
                          background: "#f9fafb",
                          borderRadius: "8px",
                        }}
                      >
                        {ReportDetails.customer_product}
                      </p>
                    </div>
                  )}

                  {/* Fundraising & Financial */}
                  {ReportDetails.fundraising_financial && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h5
                        style={{
                          fontSize: "1rem",
                          fontWeight: "600",
                          marginBottom: "0.75rem",
                          color: "#374151",
                          borderLeft: "4px solid #ec4899",
                          paddingLeft: "0.75rem",
                        }}
                      >
                        Fundraising & Financial Strategy
                      </h5>
                      <p
                        style={{
                          color: "#4b5563",
                          lineHeight: "1.6",
                          margin: 0,
                          padding: "1rem",
                          background: "#f9fafb",
                          borderRadius: "8px",
                        }}
                      >
                        {ReportDetails.fundraising_financial}
                      </p>
                    </div>
                  )}

                  {/* Future Outlook */}
                  {ReportDetails.future_outlook && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h5
                        style={{
                          fontSize: "1rem",
                          fontWeight: "600",
                          marginBottom: "0.75rem",
                          color: "#374151",
                          borderLeft: "4px solid #06b6d4",
                          paddingLeft: "0.75rem",
                        }}
                      >
                        Future Outlook
                      </h5>
                      <p
                        style={{
                          color: "#4b5563",
                          lineHeight: "1.6",
                          margin: 0,
                          padding: "1rem",
                          background: "#f9fafb",
                          borderRadius: "8px",
                        }}
                      >
                        {ReportDetails.future_outlook}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* For other types, show basic message */}
              {ReportDetails.type !== "Investor updates" && (
                <div
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    background: "#f9fafb",
                    borderRadius: "8px",
                  }}
                >
                  <FaFileAlt
                    style={{
                      fontSize: "48px",
                      color: "#9ca3af",
                      marginBottom: "1rem",
                    }}
                  />
                  <p style={{ color: "#6b7280", margin: 0 }}>
                    This document type ({ReportDetails.type}) contains
                    additional due diligence information.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "3rem" }}>
              <p style={{ color: "#6b7280" }}>Loading report details...</p>
            </div>
          )}
        </div>

        {/* Shared Investors List */}
        {/* Shared Investors List */}
        {ReportDetailsInvestor && ReportDetailsInvestor.length > 0 && (
          <div style={{ marginTop: "1.5rem" }}>
            <h5
              style={{
                fontSize: "1rem",
                fontWeight: "600",
                marginBottom: "1rem",
                color: "#374151",
                borderLeft: "4px solid #667eea",
                paddingLeft: "0.75rem",
              }}
            >
              Shared with Investors ({ReportDetailsInvestor.length})
            </h5>
            <div
              style={{
                background: "#f9fafb",
                borderRadius: "8px",
                overflow: "hidden",
                border: "1px solid #e5e7eb",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#e5e7eb",
                      borderBottom: "2px solid #d1d5db",
                    }}
                  >
                    <th
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        fontSize: "0.875rem",
                        fontWeight: "600",
                        color: "#374151",
                      }}
                    >
                      Investor Name
                    </th>
                    <th
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        fontSize: "0.875rem",
                        fontWeight: "600",
                        color: "#374151",
                      }}
                    >
                      Email
                    </th>
                    <th
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        fontSize: "0.875rem",
                        fontWeight: "600",
                        color: "#374151",
                      }}
                    >
                      Type
                    </th>
                    <th
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        fontSize: "0.875rem",
                        fontWeight: "600",
                        color: "#374151",
                      }}
                    >
                      Sent Date
                    </th>
                    <th
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        fontSize: "0.875rem",
                        fontWeight: "600",
                        color: "#374151",
                      }}
                    >
                      Last Viewed
                    </th>
                    <th
                      style={{
                        padding: "0.75rem",
                        textAlign: "center",
                        fontSize: "0.875rem",
                        fontWeight: "600",
                        color: "#374151",
                      }}
                    >
                      Access Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ReportDetailsInvestor.map((investor, index) => (
                    <tr
                      key={investor.id}
                      style={{
                        borderBottom: "1px solid #e5e7eb",
                        background: index % 2 === 0 ? "white" : "#f9fafb",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.75rem",
                          fontSize: "0.875rem",
                          color: "#111827",
                          fontWeight: "500",
                        }}
                      >
                        {investor.first_name || investor.last_name
                          ? `${investor.first_name || ""} ${investor.last_name || ""
                            }`.trim()
                          : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem",
                          fontSize: "0.875rem",
                          color: "#4b5563",
                        }}
                      >
                        {investor.investor_email || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem",
                          fontSize: "0.75rem",
                          color: "#6b7280",
                        }}
                      >
                        {investor.type_of_investor || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem",
                          fontSize: "0.875rem",
                          color: "#4b5563",
                        }}
                      >
                        {investor.sent_date
                          ? formatCurrentDate(investor.sent_date)
                          : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem",
                          fontSize: "0.875rem",
                          color: "#4b5563",
                        }}
                      >
                        {investor.date_view
                          ? formatCurrentDate(investor.date_view)
                          : "Not viewed yet"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem",
                          textAlign: "center",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.25rem 0.75rem",
                            borderRadius: "12px",
                            fontSize: "0.75rem",
                            fontWeight: "600",
                            background:
                              investor.access_status === "Download"
                                ? "#d1fae5"
                                : investor.access_status === "Only View"
                                  ? "#dbeafe"
                                  : "#fee2e2",
                            color:
                              investor.access_status === "Download"
                                ? "#065f46"
                                : investor.access_status === "Only View"
                                  ? "#1e40af"
                                  : "#991b1b",
                          }}
                        >
                          {investor.access_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* Close Footer Button */}
        <div
          style={{
            padding: "1rem 2rem",
            borderTop: "1px solid #e5e7eb",
            textAlign: "right",
            background: "#f9fafb",
          }}
        >
          <button
            className="btn btn-secondary"
            onClick={onClose}
            style={{
              padding: "0.6rem 1.5rem",
              borderRadius: "8px",
              border: "none",
              background: "#4b5563",
              color: "white",
              cursor: "pointer",
              fontWeight: "500",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#374151";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#4b5563";
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminCompanyInvestorReporting;
