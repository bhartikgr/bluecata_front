import React from "react";
import {
  DollarSign,
  TrendingUp,
  Calendar,
  Percent,
  FileText,
} from "lucide-react";

const InstrumentDataDisplay = ({ records }) => {
  // Parse the instrument type data
  const getInstrumentData = () => {
    try {
      const data = records?.instrument_type_data;

      if (!data) return null;

      let parsedData = data;

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
  const instrumentType = records.instrumentType;
  if (!instrumentData) {
    return (
      <div className="alert alert-info">
        <small>No additional instrument details available</small>
      </div>
    );
  }

  // Render Common Stock Details
  const renderCommonStockDetails = () => (
    <div className="instrument-details-section">
      <h5 className="mb-3">Common Stock Details</h5>
      <div className="details-grid">
        <div className="detail-card">
          <div className="detail-icon">
            <DollarSign size={20} />
          </div>
          <div className="detail-content">
            <label>Company Valuation:</label>{" "}
            <span>
              <b>
                {records.currency}{" "}
                {Number(
                  instrumentData.common_stock_valuation || 0
                ).toLocaleString()}
              </b>
            </span>
          </div>
        </div>

        {(instrumentData.hasWarrants === true ||
          instrumentData.hasWarrants === "true") && (
          <>
            <div className="detail-card">
              <div className="detail-icon">
                <TrendingUp size={20} />
              </div>
              <div className="detail-content">
                <label>Exercise Price:</label>{" "}
                <span>
                  <b>
                    {records.currency}{" "}
                    {Number(instrumentData.exercisePrice || 0).toLocaleString()}
                  </b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <Calendar size={20} />
              </div>
              <div className="detail-content">
                <label>Expiration Date:</label>{" "}
                <span>
                  <b>{instrumentData.expirationDate || "N/A"}</b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <FileText size={20} />
              </div>
              <div className="detail-content">
                <label>Warrant Ratio:</label>{" "}
                <span>
                  <b>{instrumentData.warrantRatio || "N/A"}</b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <FileText size={20} />
              </div>
              <div className="detail-content">
                <label>Warrant Type:</label>{" "}
                <span>
                  <b>
                    {instrumentData.warrantType === "CALL"
                      ? "Call Warrant (buy shares)"
                      : "Put Warrant (sell shares)"}
                  </b>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Render Preferred Equity Details
  const renderPreferredEquityDetails = () => (
    <div className="instrument-details-section">
      <h5 className="mb-3">Preferred Equity Details</h5>
      <div className="details-grid">
        <div className="detail-card">
          <div className="detail-icon">
            <DollarSign size={20} />
          </div>
          <div className="detail-content">
            <label>Company Valuation:</label>{" "}
            <span>
              <b>
                {records.currency}{" "}
                {Number(
                  instrumentData.preferred_valuation || 0
                ).toLocaleString()}
              </b>
            </span>
          </div>
        </div>

        {(instrumentData.hasWarrants_preferred === true ||
          instrumentData.hasWarrants_preferred === "true") && (
          <>
            <div className="detail-card">
              <div className="detail-icon">
                <TrendingUp size={20} />
              </div>
              <div className="detail-content">
                <label>Exercise Price:</label>{" "}
                <span>
                  <b>
                    {records.currency}{" "}
                    {Number(
                      instrumentData.exercisePrice_preferred || 0
                    ).toLocaleString()}
                  </b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <Calendar size={20} />
              </div>
              <div className="detail-content">
                <label>Expiration Date:</label>{" "}
                <span>
                  <b>{instrumentData.expirationDate_preferred || "N/A"}</b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <FileText size={20} />
              </div>
              <div className="detail-content">
                <label>Warrant Ratio:</label>{" "}
                <span>
                  <b>{instrumentData.warrantRatio_preferred || "N/A"}</b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <FileText size={20} />
              </div>
              <div className="detail-content">
                <label>Warrant Type:</label>{" "}
                <span>
                  <b>
                    {instrumentData.warrantType_preferred === "CALL"
                      ? "Call Warrant (buy shares)"
                      : "Put Warrant (sell shares)"}
                  </b>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Render SAFE Details
  const renderSafeDetails = () => (
    <div className="instrument-details-section">
      <h5 className="mb-3">SAFE Details</h5>
      <div className="details-grid">
        <div className="detail-card">
          <div className="detail-icon">
            <DollarSign size={20} />
          </div>
          <div className="detail-content">
            <label>Valuation Cap</label>
            <span>
              <b>
                {records.currency}{" "}
                {Number(instrumentData.valuationCap || 0).toLocaleString()}
              </b>
            </span>
          </div>
        </div>

        <div className="detail-card">
          <div className="detail-icon">
            <Percent size={20} />
          </div>
          <div className="detail-content">
            <label>Discount Rate</label>
            <span>
              <b>{instrumentData.discountRate || 0}%</b>
            </span>
          </div>
        </div>

        <div className="detail-card">
          <div className="detail-icon">
            <FileText size={20} />
          </div>
          <div className="detail-content">
            <label>SAFE Type</label>
            <span>
              <b>
                {instrumentData.safeType === "PRE_MONEY"
                  ? "Pre-Money SAFE"
                  : "Post-Money SAFE"}
              </b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // Render Venture/Bank Debt Details
  const renderDebtDetails = () => (
    <div className="instrument-details-section">
      <h5 className="mb-3">Venture/Bank Debt Details</h5>
      <div className="details-grid">
        {/* Interest Rate */}
        <div className="detail-card">
          <div className="detail-icon">
            <Percent size={20} />
          </div>
          <div className="detail-content">
            <label>Interest Rate:</label>{" "}
            <span>
              <b>{instrumentData.interestRate || 0}%</b>
            </span>
          </div>
        </div>

        {/* Repayment Schedule */}
        <div className="detail-card">
          <div className="detail-icon">
            <Calendar size={20} />
          </div>
          <div className="detail-content">
            <label>Repayment Schedule:</label>{" "}
            <span>
              <b>{instrumentData.repaymentSchedule || 0} months</b>
            </span>
          </div>
        </div>

        {/* Warrants Section */}
        {instrumentData.hasWarrants_Bank && (
          <>
            <div className="detail-card">
              <div className="detail-icon">
                <TrendingUp size={20} />
              </div>
              <div className="detail-content">
                <label>Exercise Price:</label>{" "}
                <span>
                  <b>
                    {records.currency}{" "}
                    {Number(
                      instrumentData.exercisePrice_bank || 0
                    ).toLocaleString()}
                  </b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <Calendar size={20} />
              </div>
              <div className="detail-content">
                <label>Expiration Date:</label>{" "}
                <span>
                  <b>{instrumentData.exercisedate_bank || "N/A"}</b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <FileText size={20} />
              </div>
              <div className="detail-content">
                <label>Warrant Ratio:</label>{" "}
                <span>
                  <b>{instrumentData.warrantRatio_bank || "N/A"}</b>
                </span>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-icon">
                <FileText size={20} />
              </div>
              <div className="detail-content">
                <label>Warrant Type:</label>{" "}
                <span>
                  <b>
                    {instrumentData.warrantType_bank === "CALL"
                      ? "Call Warrant (buy shares)"
                      : "Put Warrant (sell shares)"}
                  </b>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Render Convertible Note Details
  const renderConvertibleNoteDetails = () => (
    <div className="instrument-details-section">
      <h5 className="mb-3">Convertible Note Details</h5>
      <div className="details-grid">
        <div className="detail-card">
          <div className="detail-icon">
            <DollarSign size={20} />
          </div>
          <div className="detail-content">
            <label>Valuation Cap:</label>{" "}
            <span>
              <b>
                {records.currency}{" "}
                {Number(instrumentData.valuationCap_note || 0).toLocaleString()}
              </b>
            </span>
          </div>
        </div>

        <div className="detail-card">
          <div className="detail-icon">
            <Percent size={20} />
          </div>
          <div className="detail-content">
            <label>Discount Rate:</label>{" "}
            <span>
              <b>{instrumentData.discountRate_note || 0}%</b>
            </span>
          </div>
        </div>

        <div className="detail-card">
          <div className="detail-icon">
            <Calendar size={20} />
          </div>
          <div className="detail-content">
            <label>Maturity Date:</label>{" "}
            <span>
              <b>{instrumentData.maturityDate || "N/A"}</b>
            </span>
          </div>
        </div>

        <div className="detail-card">
          <div className="detail-icon">
            <Percent size={20} />
          </div>
          <div className="detail-content">
            <label>Interest Rate:</label>{" "}
            <span>
              <b>{instrumentData.interestRate_note || 0}%</b>
            </span>
          </div>
        </div>

        <div className="detail-card">
          <div className="detail-icon">
            <FileText size={20} />
          </div>
          <div className="detail-content">
            <label>Convertible Trigger:</label>{" "}
            <span>
              <b>
                {instrumentData.convertibleTrigger?.replace(/_/g, " ") || "N/A"}
              </b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // Render based on instrument type
  const renderInstrumentDetails = () => {
    switch (instrumentType) {
      case "Common Stock":
        return renderCommonStockDetails();
      case "Preferred Equity":
        return renderPreferredEquityDetails();
      case "Safe":
        return renderSafeDetails();
      case "Venture/Bank DEBT":
        return renderDebtDetails();
      case "Convertible Note":
        return renderConvertibleNoteDetails();
      default:
        return null;
    }
  };

  return (
    <div className="mt-4">
      <div className="section-title">
        <h4>Instrument Specific Details</h4>
        <p>Additional details for {instrumentType}</p>
      </div>
      {renderInstrumentDetails()}
    </div>
  );
};

export default InstrumentDataDisplay;
