import React, { useState, useEffect } from "react";
import axios from "axios";
import { FaTimes, FaFileAlt, FaInfoCircle } from "react-icons/fa";
import {
  TrendingUp,
  DollarSign,
  Share2,
  Calendar,
  Shield,
  FileText,
  Award,
} from "lucide-react";
import { FaEllipsis } from "react-icons/fa6";

function AdminCompanyRecordRound({ ReportId, onClose }) {
  const [ReportDetails, setReportDetails] = useState(null);
  const apiUrl = "http://localhost:5000/api/admin/company/";

  useEffect(() => {
    if (ReportId) totalDocs();
  }, [ReportId]);

  const totalDocs = async () => {
    let formData = { ReportId: ReportId };
    try {
      const res = await axios.post(
        apiUrl + "getCompanyRecordRoundDetails",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setReportDetails(res.data.results);
    } catch (err) {
      console.error("Error fetching company data:", err);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Not provided";
    const date = new Date(dateString);
    if (isNaN(date)) return "Not provided";
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
  };

  const formatNumber = (num) => {
    if (!num) return "Not provided";
    return Number(num).toLocaleString("en-US");
  };

  const InfoCard = ({ icon: Icon, title, children, accent = "#667eea" }) => (
    <div
      style={{
        background: "white",
        borderRadius: "12px",
        padding: "1.5rem",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        border: "1px solid #e5e7eb",
        transition: "all 0.3s ease",
        marginBottom: "1.5rem",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            background: `linear-gradient(135deg, ${accent}20 0%, ${accent}40 100%)`,
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: accent,
          }}
        >
          <Icon size={20} />
        </div>
        <h4
          style={{
            margin: 0,
            fontSize: "1.1rem",
            fontWeight: "600",
            color: "#1f2937",
          }}
        >
          {title}
        </h4>
      </div>
      {children}
    </div>
  );

  const DataRow = ({ label, value }) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "0.75rem 0",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      <span
        style={{
          color: "#6b7280",
          fontSize: "0.9rem",
          fontWeight: "500",
          flex: "0 0 40%",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "#1f2937",
          fontSize: "0.95rem",
          fontWeight: "500",
          textAlign: "right",
          flex: "1",
        }}
      >
        {value || (
          <span style={{ color: "#9ca3af", fontStyle: "italic" }}>
            Not provided
          </span>
        )}
      </span>
    </div>
  );

  const StatusBadge = ({ status }) => {
    const isActive = status === "ACTIVE";
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 14px",
          borderRadius: "20px",
          fontSize: "0.85rem",
          fontWeight: "600",
          background: isActive ? "#dcfce7" : "#e0e7ff",
          color: isActive ? "#16a34a" : "#4f46e5",
        }}
      >
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: isActive ? "#16a34a" : "#4f46e5",
          }}
        />
        {status}
      </span>
    );
  };

  if (!ReportDetails) {
    return (
      <div
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
        <div style={{ color: "white", fontSize: "1.2rem" }}>Loading...</div>
      </div>
    );
  }

  // Helper function to parse JSON strings
  const parseJsonField = (field) => {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    try {
      const parsed = JSON.parse(field);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const data = {
    ...ReportDetails,
    termsheetFile: parseJsonField(ReportDetails.termsheetFile),
    subscriptiondocument: parseJsonField(ReportDetails.subscriptiondocument),
    liquidation: parseJsonField(ReportDetails.liquidation),
  };
  const getInstrumentData = () => {
    try {
      const dataa = data?.instrument_type_data;

      if (!dataa) return null;

      let parsedData = dataa;

      // First parse if it's a string
      if (typeof parsedData === "string") {
        parsedData = JSON.parse(parsedData);
      }

      // Some cases may still return a string (double-encoded JSON)
      if (typeof parsedData === "string") {
        parsedData = JSON.parse(parsedData);
      }

      return parsedData;
    } catch (error) {
      console.error("Error parsing instrument data:", error);
      return null;
    }
  };
  const instrumentData = getInstrumentData();
  return (
    <div
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
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "16px",
          width: "1000px",
          maxWidth: "95%",
          maxHeight: "95vh",
          position: "relative",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            padding: "2rem",
            position: "relative",
          }}
        >
          <button
            onClick={onClose}
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              border: "none",
              background: "rgba(255, 255, 255, 0.2)",
              cursor: "pointer",
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              transition: "all 0.2s ease",
              backdropFilter: "blur(10px)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
            }}
          >
            <FaTimes size={18} />
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div
              style={{
                width: "60px",
                height: "60px",
                background: "rgba(255, 255, 255, 0.2)",
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(10px)",
              }}
            >
              <TrendingUp size={30} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.75rem", fontWeight: "700" }}>
                {data.nameOfRound || "Funding Round"}{" "}
                {data.shareClassType && data.shareClassType !== "null"
                  ? `- ${data.shareClassType}`
                  : ""}
              </h2>
              <p
                style={{ margin: "6px 0 0 0", opacity: 0.95, fontSize: "1rem" }}
              >
                {data.instrumentType || "Investment Details"}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "2rem",
            overflowY: "auto",
            flex: 1,
            background: "#f9fafb",
          }}
        >
          {/* Key Metrics */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
              marginBottom: "2rem",
            }}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                borderRadius: "12px",
                padding: "1.5rem",
                color: "white",
              }}
            >
              <DollarSign
                size={24}
                style={{ marginBottom: "0.5rem", opacity: 0.9 }}
              />
              <div
                style={{
                  fontSize: "0.85rem",
                  opacity: 0.9,
                  marginBottom: "4px",
                }}
              >
                Target Raise Amount
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: "700" }}>
                {Number(data.roundsize).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {data.currency || ""}
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                borderRadius: "12px",
                padding: "1.5rem",
                color: "white",
              }}
            >
              <Share2
                size={24}
                style={{ marginBottom: "0.5rem", opacity: 0.9 }}
              />
              <div
                style={{
                  fontSize: "0.85rem",
                  opacity: 0.9,
                  marginBottom: "4px",
                }}
              >
                Number of Shares
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: "700" }}>
                {Number(data.issuedshares).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
                borderRadius: "12px",
                padding: "1.5rem",
                color: "white",
              }}
            >
              <Calendar
                size={24}
                style={{ marginBottom: "0.5rem", opacity: 0.9 }}
              />
              <div
                style={{
                  fontSize: "0.85rem",
                  opacity: 0.9,
                  marginBottom: "4px",
                }}
              >
                Status
              </div>
              <div
                style={{
                  fontSize: "1.2rem",
                  fontWeight: "700",
                  marginTop: "8px",
                }}
              >
                {data.roundStatus ? (
                  <StatusBadge status={data.roundStatus} />
                ) : (
                  "N/A"
                )}
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
                borderRadius: "12px",
                padding: "1.5rem",
                color: "white",
              }}
            >
              <Share2
                size={24}
                style={{ marginBottom: "0.5rem", opacity: 0.9 }}
              />
              <div
                style={{
                  fontSize: "0.85rem",
                  opacity: 0.9,
                  marginBottom: "4px",
                }}
              >
                Report Shared
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: "700" }}>
                {data.is_shared || "No"}
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
                borderRadius: "12px",
                padding: "1.5rem",
                color: "white",
              }}
            >
              <Share2
                size={24}
                style={{ marginBottom: "0.5rem", opacity: 0.9 }}
              />
              <div
                style={{
                  fontSize: "0.85rem",
                  opacity: 0.9,
                  marginBottom: "4px",
                }}
              >
                Investors Shared With
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: "700" }}>
                {data.total_investors_shared || 0}
              </div>
            </div>
          </div>

          {/* Description */}
          {data.description && data.description !== "null" && (
            <InfoCard icon={FaInfoCircle} title="Description" accent="#667eea">
              <p style={{ margin: 0, color: "#4b5563", lineHeight: "1.6" }}>
                {data.description}
              </p>
            </InfoCard>
          )}

          {/* Round Details */}
          <InfoCard icon={TrendingUp} title="Round Details" accent="#8b5cf6">
            <div>
              {data.shareClassType && data.shareClassType !== "null" && (
                <DataRow label="Share Class Type" value={data.shareClassType} />
              )}
              {data.shareclassother && data.shareclassother !== "null" && (
                <DataRow
                  label="Custom Share Class"
                  value={data.shareclassother}
                />
              )}
              {data.instrumentType && data.instrumentType !== "null" && (
                <DataRow
                  label="Investment Instrument"
                  value={data.instrumentType}
                />
              )}
              {data.customInstrument && data.customInstrument !== "null" && (
                <DataRow
                  label="Custom Instrument"
                  value={data.customInstrument}
                />
              )}
              {data.roundStatus === "CLOSED" && data.dateroundclosed && (
                <DataRow
                  label="Date Round Closed"
                  value={formatDate(data.dateroundclosed)}
                />
              )}
            </div>
          </InfoCard>

          {/* Instrument Specific Details */}
          {data.instrumentType === "Common Stock" && (
            <InfoCard
              icon={Award}
              title="Common Stock Details"
              accent="#10b981"
            >
              <div>
                <DataRow
                  label="Company Valuation"
                  value={instrumentData.common_stock_valuation}
                />
                <DataRow
                  label="Has Warrants"
                  value={instrumentData.hasWarrants ? "Yes" : "No"}
                />
                {instrumentData.hasWarrants && (
                  <>
                    <DataRow
                      label="Exercise Price"
                      value={instrumentData.exercisePrice}
                    />
                    <DataRow
                      label="Expiration Date"
                      value={
                        instrumentData.expirationDate
                          ? formatDate(instrumentData.expirationDate)
                          : null
                      }
                    />
                    <DataRow
                      label="Warrant Ratio"
                      value={instrumentData.warrantRatio}
                    />
                    <DataRow
                      label="Warrant Type"
                      value={instrumentData.warrantType || "CALL"}
                    />
                  </>
                )}
              </div>
            </InfoCard>
          )}

          {data.instrumentType === "Preferred Equity" && (
            <InfoCard
              icon={Award}
              title="Preferred Equity Details"
              accent="#10b981"
            >
              <div>
                <DataRow
                  label="Company Valuation"
                  value={instrumentData.preferred_valuation}
                />
                <DataRow
                  label="Has Warrants"
                  value={instrumentData.hasWarrants_preferred ? "Yes" : "No"}
                />
                {instrumentData.hasWarrants_preferred && (
                  <>
                    <DataRow
                      label="Exercise Price"
                      value={instrumentData.exercisePrice_preferred}
                    />
                    <DataRow
                      label="Expiration Date"
                      value={
                        instrumentData.expirationDate_preferred
                          ? formatDate(instrumentData.expirationDate_preferred)
                          : null
                      }
                    />
                    <DataRow
                      label="Warrant Ratio"
                      value={instrumentData.warrantRatio_preferred}
                    />
                    <DataRow
                      label="Warrant Type"
                      value={instrumentData.warrantType_preferred || "CALL"}
                    />
                  </>
                )}
              </div>
            </InfoCard>
          )}

          {data.instrumentType === "Safe" && (
            <InfoCard icon={Shield} title="SAFE Details" accent="#f59e0b">
              <div>
                <DataRow
                  label="Valuation Cap"
                  value={instrumentData.valuationCap}
                />
                <DataRow
                  label="Discount Rate"
                  value={
                    instrumentData.discountRate
                      ? `${instrumentData.discountRate}%`
                      : null
                  }
                />
                <DataRow
                  label="SAFE Type"
                  value={
                    instrumentData.safeType === "PRE_MONEY"
                      ? "Pre-Money SAFE"
                      : instrumentData.safeType === "POST_MONEY"
                        ? "Post-Money SAFE"
                        : null
                  }
                />
              </div>
            </InfoCard>
          )}

          {data.instrumentType === "Venture/Bank DEBT" && (
            <InfoCard
              icon={DollarSign}
              title="Venture/Bank Debt Details"
              accent="#ef4444"
            >
              <div>
                <DataRow
                  label="Interest Rate"
                  value={
                    instrumentData.interestRate
                      ? `${instrumentData.interestRate}%`
                      : null
                  }
                />
                <DataRow
                  label="Repayment Schedule"
                  value={
                    instrumentData.repaymentSchedule
                      ? `${instrumentData.repaymentSchedule} months`
                      : null
                  }
                />
                <DataRow
                  label="Has Warrants"
                  value={instrumentData.hasWarrants_Bank ? "Yes" : "No"}
                />
                {instrumentData.hasWarrants_Bank && (
                  <>
                    <DataRow
                      label="Exercise Price"
                      value={instrumentData.exercisePrice_bank}
                    />
                    <DataRow
                      label="Expiration Date"
                      value={
                        instrumentData.exercisedate_bank
                          ? formatDate(instrumentData.exercisedate_bank)
                          : null
                      }
                    />
                    <DataRow
                      label="Warrant Ratio"
                      value={instrumentData.warrantRatio_bank}
                    />
                    <DataRow
                      label="Warrant Type"
                      value={
                        instrumentData.warrantType_bank === "CALL"
                          ? "Call Warrant"
                          : instrumentData.warrantType_bank === "PUT"
                            ? "Put Warrant"
                            : null
                      }
                    />
                  </>
                )}
              </div>
            </InfoCard>
          )}

          {data.instrumentType === "Convertible Note" && (
            <InfoCard
              icon={FileText}
              title="Convertible Note Details"
              accent="#ec4899"
            >
              <div>
                <DataRow
                  label="Valuation Cap"
                  value={instrumentData.valuationCap}
                />
                <DataRow
                  label="Discount Rate"
                  value={
                    instrumentData.discountRate
                      ? `${instrumentData.discountRate}%`
                      : null
                  }
                />
                <DataRow
                  label="Maturity Date"
                  value={
                    instrumentData.maturityDate
                      ? formatDate(instrumentData.maturityDate)
                      : null
                  }
                />
                <DataRow
                  label="Interest Rate"
                  value={
                    instrumentData.interestRate
                      ? `${instrumentData.interestRate}%`
                      : null
                  }
                />
                <DataRow
                  label="Convertible Trigger"
                  value={
                    instrumentData.convertibleTrigger === "QUALIFIED_FINANCING"
                      ? "Qualified Equity Financing"
                      : instrumentData.convertibleTrigger === "ACQUISITION_IPO"
                        ? "Acquisition or IPO"
                        : instrumentData.convertibleTrigger === "MATURITY_DATE"
                          ? "Reaching Maturity Date"
                          : null
                  }
                />
              </div>
            </InfoCard>
          )}

          {/* Rights & Preferences */}
          {(data.rights ||
            data.liquidationpreferences ||
            data.convertible ||
            data.voting) && (
              <InfoCard
                icon={Shield}
                title="Rights & Preferences"
                accent="#6366f1"
              >
                <div>
                  {data.rights && data.rights !== "null" && (
                    <DataRow label="Rights & Preferences" value={data.rights} />
                  )}
                  {data.liquidationpreferences &&
                    data.liquidationpreferences !== "null" && (
                      <DataRow
                        label="Liquidation Preferences"
                        value={data.liquidationpreferences}
                      />
                    )}
                  {data.liquidation && data.liquidation !== "null" && (
                    <DataRow
                      label="Liquidation Participating"
                      value={data.liquidation}
                    />
                  )}
                  {data.liquidationOther && data.liquidationOther !== "null" && (
                    <DataRow
                      label="Other Liquidation Terms"
                      value={data.liquidationOther}
                    />
                  )}
                  {data.convertible && data.convertible !== "null" && (
                    <DataRow
                      label="Shares Convertible"
                      value={data.convertible}
                    />
                  )}
                  {data.convertibleType && data.convertibleType !== "null" && (
                    <DataRow
                      label="Convertible Type"
                      value={data.convertibleType}
                    />
                  )}
                  {data.voting && data.voting !== "null" && (
                    <DataRow label="Voting Rights" value={data.voting} />
                  )}
                </div>
              </InfoCard>
            )}

          {/* Documents */}
          {((data.termsheetFile && data.termsheetFile.length > 0) ||
            (data.subscriptiondocument &&
              data.subscriptiondocument.length > 0)) && (
              <InfoCard icon={FileText} title="Documents" accent="#14b8a6">
                <div>
                  {data.termsheetFile && data.termsheetFile.length > 0 && (
                    <div style={{ marginBottom: "1rem" }}>
                      <div
                        style={{
                          color: "#6b7280",
                          fontSize: "0.9rem",
                          fontWeight: "600",
                          marginBottom: "0.5rem",
                        }}
                      >
                        Term Sheet:
                      </div>
                      {data.termsheetFile.map((file, index) => (
                        <div
                          key={index}
                          style={{
                            padding: "0.5rem",
                            background: "#f3f4f6",
                            borderRadius: "6px",
                            marginBottom: "0.5rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <FileText size={16} style={{ color: "#667eea" }} />
                          <span style={{ fontSize: "0.9rem" }}>
                            {file.name || file}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {data.subscriptiondocument &&
                    data.subscriptiondocument.length > 0 && (
                      <div>
                        <div
                          style={{
                            color: "#6b7280",
                            fontSize: "0.9rem",
                            fontWeight: "600",
                            marginBottom: "0.5rem",
                          }}
                        >
                          Subscription Document:
                        </div>
                        {data.subscriptiondocument.map((file, index) => (
                          <div
                            key={index}
                            style={{
                              padding: "0.5rem",
                              background: "#f3f4f6",
                              borderRadius: "6px",
                              marginBottom: "0.5rem",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            <FileText size={16} style={{ color: "#667eea" }} />
                            <span style={{ fontSize: "0.9rem" }}>
                              {file.name || file}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </InfoCard>
            )}
          {/* Shared Investors Details */}
          {data.is_shared === "Yes" &&
            data.shared_investors_details &&
            data.shared_investors_details.length > 0 && (
              <InfoCard
                icon={Share2}
                title="Shared With Investors"
                accent="#8b5cf6"
              >
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr
                        style={{
                          background: "#f3f4f6",
                          borderBottom: "2px solid #e5e7eb",
                        }}
                      >
                        <th
                          style={{
                            padding: "0.75rem",
                            textAlign: "left",
                            fontSize: "0.85rem",
                            fontWeight: "600",
                            color: "#4b5563",
                          }}
                        >
                          Investor Name
                        </th>
                        <th
                          style={{
                            padding: "0.75rem",
                            textAlign: "left",
                            fontSize: "0.85rem",
                            fontWeight: "600",
                            color: "#4b5563",
                          }}
                        >
                          Investor Email
                        </th>
                        <th
                          style={{
                            padding: "0.75rem",
                            textAlign: "left",
                            fontSize: "0.85rem",
                            fontWeight: "600",
                            color: "#4b5563",
                          }}
                        >
                          Sent Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.shared_investors_details.map((investor, index) => (
                        <tr
                          key={index}
                          style={{ borderBottom: "1px solid #f3f4f6" }}
                        >
                          <td
                            style={{
                              padding: "0.75rem",
                              fontSize: "0.9rem",
                              color: "#1f2937",
                            }}
                          >
                            {investor.first_name} {investor.last_name}
                          </td>
                          <td
                            style={{
                              padding: "0.75rem",
                              fontSize: "0.9rem",
                              color: "#1f2937",
                            }}
                          >
                            {investor.email}
                          </td>
                          <td
                            style={{
                              padding: "0.75rem",
                              fontSize: "0.9rem",
                              color: "#1f2937",
                            }}
                          >
                            {formatDate(investor.sent_date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </InfoCard>
            )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 2rem",
            borderTop: "1px solid #e5e7eb",
            textAlign: "right",
            background: "#f9fafb",
          }}
        >
          <button
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

export default AdminCompanyRecordRound;
