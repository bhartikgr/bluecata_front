import React from "react";
import { VscOpenPreview } from "react-icons/vsc";
import {
  FaDownload,
  FaCalendar,
  FaLock,
  FaShare,
  FaFileAlt,
} from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import { MdDescription } from "react-icons/md";

const ViewRecordReport = ({ onClose, recordViewData }) => {
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatCurrency = (amount, currency) => {
    if (!amount) return "N/A";
    const currencySymbol =
      currency === "USD" ? "$" : currency === "EUR" ? "€" : currency || "";
    return `${currencySymbol}${parseFloat(amount).toLocaleString()}`;
  };

  const InfoBox = ({ label, value }) => (
    <div className="col-md-6">
      <div className="p-3 bg-light rounded-3 h-100">
        <span className="text-secondary small fw-semibold text-uppercase">
          {label}:
        </span>
        <p className="mb-0 mt-1 fw-medium text-dark fs-6">
          {value || <span className="text-muted">Not provided</span>}
        </p>
      </div>
    </div>
  );

  const InfoBoxFull = ({ label, value }) => (
    <div className="col-12">
      <div className="p-3 bg-light rounded-3 h-100">
        <span className="text-secondary small fw-semibold text-uppercase">
          {label}:
        </span>
        <p className="mb-0 mt-1 fw-medium text-dark fs-6">
          {value || <span className="text-muted">Not provided</span>}
        </p>
      </div>
    </div>
  );

  const DetailItem = ({ label, value, description }) => (
    <div className="mb-3">
      <label className="form-label fw-semibold">{label}</label>
      <p className="mb-1 fw-medium text-dark fs-6">
        {value || <span className="text-muted">Not provided</span>}
      </p>
      {description && (
        <small className="text-muted d-block">{description}</small>
      )}
    </div>
  );

  // Parse instrument_type_data if it's a JSON string
  let instrumentData = {};
  try {
    if (recordViewData?.instrument_type_data) {
      instrumentData =
        typeof recordViewData.instrument_type_data === "string"
          ? JSON.parse(recordViewData.instrument_type_data)
          : recordViewData.instrument_type_data;
    }
  } catch (e) {
    console.error("Error parsing instrument_type_data:", e);
  }
  const renderInstrumentDetails = () => {
    if (!recordViewData?.instrumentType) return null;

    let data = {};
    try {
      if (recordViewData.instrument_type_data) {
        data = recordViewData.instrument_type_data;
        if (typeof data === "string") data = JSON.parse(data);
        if (typeof data === "string") data = JSON.parse(data);
      }
    } catch (error) {
      console.error(
        `Error parsing ${recordViewData.instrumentType} data:`,
        error
      );
      data = {};
    }

    const formatNumber = (value) => {
      if (value === undefined || value === null || value === "")
        return "Not provided";
      return Number(value).toLocaleString("en-US");
    };

    switch (recordViewData.instrumentType) {
      case "Common Stock":
        return (
          <div className="mt-3 p-3 border rounded bg-light">
            <h5 className="fw-bold mb-3">Common Stock Details</h5>

            <DetailItem
              label="Company Valuation"
              value={formatNumber(data.common_stock_valuation)}
            />
            <DetailItem
              label="Add Warrants (optional)"
              value={data.hasWarrants ? "Yes" : "No"}
            />

            {data.hasWarrants && (
              <>
                <DetailItem
                  label="Exercise Price (Strike Price)"
                  value={formatNumber(data.exercisePrice)}
                />
                <DetailItem
                  label="Expiration Date"
                  value={data.expirationDate || "Not provided"}
                />
                <DetailItem
                  label="Warrant Ratio"
                  value={data.warrantRatio || "Not provided"}
                />
                <DetailItem
                  label="Type of Warrant"
                  value={data.warrantType || "CALL"}
                />
              </>
            )}
          </div>
        );

      case "Preferred Equity":
        return (
          <div className="mt-3 p-3 border rounded bg-light">
            <h5 className="fw-bold mb-3">Preferred Equity Details</h5>

            <DetailItem
              label="Company Valuation"
              value={formatNumber(data.preferred_valuation)}
            />
            <DetailItem
              label="Add Warrants (optional)"
              value={data.hasWarrants_preferred ? "Yes" : "No"}
            />

            {data.hasWarrants_preferred && (
              <>
                <DetailItem
                  label="Exercise Price (Strike Price)"
                  value={formatNumber(data.exercisePrice_preferred)}
                />
                <DetailItem
                  label="Expiration Date"
                  value={data.expirationDate_preferred || "Not provided"}
                />
                <DetailItem
                  label="Warrant Ratio"
                  value={data.warrantRatio_preferred || "Not provided"}
                />
                <DetailItem
                  label="Type of Warrant"
                  value={data.warrantType_preferred || "CALL"}
                />
              </>
            )}
          </div>
        );

      case "Convertible Note":
        return (
          <div className="mt-3 p-3 border rounded bg-light">
            <h5 className="fw-bold mb-3">Convertible Note Details</h5>

            <DetailItem
              label="Valuation Cap"
              value={formatNumber(data.valuationCap_note)}
            />
            <DetailItem
              label="Discount Rate (%)"
              value={
                data.discountRate_note
                  ? `${data.discountRate_note}%`
                  : "Not provided"
              }
            />
            <DetailItem
              label="Maturity Date"
              value={data.maturityDate || "Not provided"}
            />
            <DetailItem
              label="Interest Rate (%)"
              value={
                data.interestRate_note
                  ? `${data.interestRate_note}%`
                  : "Not provided"
              }
            />
            <DetailItem
              label="Convertible Trigger"
              value={
                data.convertibleTrigger?.replace(/_/g, " & ") || "Not provided"
              }
            />
          </div>
        );

      case "Safe":
        return (
          <div className="mt-3 p-3 border rounded bg-light">
            <h5 className="fw-bold mb-3">SAFE Details</h5>

            <DetailItem
              label="Valuation Cap"
              value={formatNumber(data.valuationCap)}
            />
            <DetailItem
              label="Discount Rate (%)"
              value={
                data.discountRate ? `${data.discountRate}%` : "Not provided"
              }
            />
            <DetailItem
              label="SAFE Type"
              value={
                data.safeType
                  ? data.safeType
                      .replace(/_/g, "-")
                      .toLowerCase()
                      .replace(/\b\w/g, (l) => l.toUpperCase())
                  : "Not provided"
              }
            />
          </div>
        );

      case "Venture/Bank DEBT":
        return (
          <div className="mt-3 p-3 border rounded bg-light">
            <h5 className="fw-bold mb-3">Venture/Bank Debt Details</h5>

            <DetailItem
              label="Interest Rate (%)"
              value={
                data.interestRate ? `${data.interestRate}%` : "Not provided"
              }
            />
            <DetailItem
              label="Repayment Schedule (months)"
              value={data.repaymentSchedule || "Not provided"}
            />
            <DetailItem
              label="Add Warrants (optional)"
              value={data.hasWarrants_Bank ? "Yes" : "No"}
            />

            {data.hasWarrants_Bank && (
              <>
                <DetailItem
                  label="Exercise Price (Strike Price)"
                  value={formatNumber(data.exercisePrice_bank)}
                />
                <DetailItem
                  label="Expiration Date"
                  value={data.exercisedate_bank || "Not provided"}
                />
                <DetailItem
                  label="Warrant Ratio"
                  value={data.warrantRatio_bank || "Not provided"}
                />
                <DetailItem
                  label="Type of Warrant"
                  value={data.warrantType_bank || "CALL"}
                />
              </>
            )}
          </div>
        );

      default:
        return null;
    }
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
          maxWidth: "1400px",
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
                  {recordViewData?.nameOfRound || "Round Details"}
                </h3>
                <small className="text-muted">
                  Record ID: #{recordViewData?.id}
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
          {/* Basic Round Information */}
          <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
            <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
              <MdDescription className="me-2" />
              Basic Round Information
            </h5>
            <div className="row g-3">
              <InfoBox
                label="Name of Round"
                value={`${recordViewData?.nameOfRound || ""} ${
                  recordViewData?.shareClassType || ""
                }`}
              />
              <InfoBox
                label="Share Class Type"
                value={recordViewData?.shareClassType}
              />

              {recordViewData?.shareClassType === "OTHER" && (
                <InfoBox
                  label="Custom Share Class Name"
                  value={recordViewData?.shareclassother}
                />
              )}

              <InfoBoxFull
                label="Description"
                value={recordViewData?.description}
              />

              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Status:
                  </span>
                  <div className="mt-2 d-flex gap-2">
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
                    <span
                      className={`badge ${
                        recordViewData?.is_locked === "Yes"
                          ? "bg-danger"
                          : "bg-success"
                      }`}
                    >
                      <FaLock className="me-1" size={12} />
                      {recordViewData?.is_locked === "Yes"
                        ? "Locked"
                        : "Unlocked"}
                    </span>
                  </div>
                </div>
              </div>

              <InfoBox
                label="Created At"
                value={formatDate(recordViewData?.created_at)}
              />
            </div>
          </div>

          {/* Investment Instrument */}
          <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
            <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
              Investment Instrument
            </h5>
            <div className="row g-3">
              <InfoBox
                label="Investment Instrument"
                value={recordViewData?.instrumentType}
              />

              {recordViewData?.instrumentType === "OTHER" && (
                <InfoBox
                  label="Custom Investment Instrument Name"
                  value={recordViewData?.customInstrument}
                />
              )}
            </div>

            {renderInstrumentDetails()}
          </div>

          {/* Financial Details */}
          <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
            <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
              Financial Details
            </h5>
            <div className="row g-3">
              <InfoBox
                label="Amount"
                value={formatCurrency(
                  recordViewData?.roundsize,
                  recordViewData?.currency
                )}
              />
              <InfoBox label="Currency" value={recordViewData?.currency} />
              <InfoBox
                label="Total Shares"
                value={
                  recordViewData?.issuedshares
                    ? Number(recordViewData.issuedshares).toLocaleString(
                        "en-US"
                      )
                    : null
                }
              />
              <InfoBox
                label="Is this round closed or active"
                value={
                  recordViewData?.roundStatus === "CLOSED" ? "CLOSED" : "ACTIVE"
                }
              />

              {recordViewData?.roundStatus === "CLOSED" && (
                <InfoBox
                  label="Date Round Closed"
                  value={formatDate(recordViewData?.dateroundclosed)}
                />
              )}
            </div>
          </div>

          {/* Rights & Preferences */}
          <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
            <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
              Rights & Preferences
            </h5>
            <div className="row g-3">
              <InfoBoxFull
                label="Rights & Preferences"
                value={recordViewData?.rights}
              />
              <InfoBox
                label="Liquidation Preference Details"
                value={recordViewData?.liquidationpreferences}
              />
              <InfoBox
                label="Liquidation Participating"
                value={
                  recordViewData?.liquidation
                    ? typeof recordViewData.liquidation === "string"
                      ? recordViewData.liquidation
                      : Array.isArray(recordViewData.liquidation)
                      ? recordViewData.liquidation.join(", ")
                      : recordViewData.liquidation
                    : null
                }
              />

              {recordViewData?.liquidation &&
                (recordViewData.liquidation.includes?.("OTHER") ||
                  recordViewData.liquidation === "OTHER") && (
                  <InfoBox
                    label="Other"
                    value={recordViewData?.liquidationOther}
                  />
                )}

              <InfoBox
                label="Shares are convertible"
                value={recordViewData?.convertible}
              />

              {recordViewData?.convertible === "Yes" && (
                <InfoBox
                  label="Convertible Type"
                  value={recordViewData?.convertibleType}
                />
              )}

              <InfoBox
                label="Shareholders Voting Rights"
                value={recordViewData?.voting}
              />
            </div>
          </div>

          {/* Documents */}
          {((recordViewData?.termsheetFile &&
            recordViewData.termsheetFile.length > 0) ||
            (recordViewData?.subscriptiondocument &&
              recordViewData.subscriptiondocument.length > 0)) && (
            <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
              <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                <FaFileAlt className="me-2" />
                Documents
              </h5>
              <div className="row g-3">
                {recordViewData?.termsheetFile &&
                  recordViewData.termsheetFile.length > 0 && (
                    <div className="col-12">
                      <div className="p-3 bg-light rounded-3">
                        <span className="text-secondary small fw-semibold text-uppercase">
                          Term Sheet Name(s):
                        </span>
                        <ul className="mb-0 mt-2 ps-3">
                          {(typeof recordViewData.termsheetFile === "string"
                            ? JSON.parse(recordViewData.termsheetFile)
                            : recordViewData.termsheetFile
                          ).map((file, index) => (
                            <li
                              key={index}
                              className="mb-1 fw-medium text-dark"
                            >
                              <i className="bi bi-file-earmark-text me-2 text-primary"></i>
                              {file.name || file}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                {recordViewData?.subscriptiondocument &&
                  recordViewData.subscriptiondocument.length > 0 && (
                    <div className="col-12">
                      <div className="p-3 bg-light rounded-3">
                        <span className="text-secondary small fw-semibold text-uppercase">
                          Subscription Document:
                        </span>
                        <ul className="mb-0 mt-2 ps-3">
                          {(typeof recordViewData.subscriptiondocument ===
                          "string"
                            ? JSON.parse(recordViewData.subscriptiondocument)
                            : recordViewData.subscriptiondocument
                          ).map((file, index) => (
                            <li
                              key={index}
                              className="mb-1 fw-medium text-dark"
                            >
                              <i className="bi bi-file-earmark-text me-2 text-primary"></i>
                              {file.name || file}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}

          {/* General Notes */}
          {recordViewData?.generalnotes && (
            <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
              <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
                General Notes
              </h5>
              <div
                className="p-3 bg-light rounded-3"
                style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}
              >
                {recordViewData.generalnotes}
              </div>
            </div>
          )}

          {/* Creator Information */}
          <div className="mb-4 p-4 bg-white border rounded-3 shadow-sm">
            <h5 className="mb-3 pb-2 border-bottom fw-bold text-dark">
              Record Information
            </h5>
            <div className="row g-3">
              <InfoBox
                label="Created By Role"
                value={recordViewData?.created_by_role}
              />

              <InfoBox
                label="Updated By Role"
                value={recordViewData?.updated_by_role}
              />
            </div>
          </div>
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
        </div>
      </div>
    </div>
  );
};

export default ViewRecordReport;
