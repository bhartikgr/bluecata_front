import { VscOpenPreview } from "react-icons/vsc";
import { FaDownload } from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  Overlay,
  ModalContainer,
  ModalTitle,
  CloseButton,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";

const ViewRecordRound = ({ onClose, recordViewData }) => {
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);

  // Helper function to safely parse JSON data
  const safeJsonParse = (data) => {
    if (!data) return {};
    try {
      let parsed = data;
      // If it's a string, parse it
      if (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
      }
      // If the result is still a string (double-encoded), parse again
      if (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
      }
      return parsed || {};
    } catch (error) {
      console.error("Error parsing JSON data:", error);
      return {};
    }
  };

  // Parse files and instrument data
  const termsheetFiles = Array.isArray(recordViewData.termsheetFile)
    ? recordViewData.termsheetFile
    : typeof recordViewData.termsheetFile === "string"
      ? safeJsonParse(recordViewData.termsheetFile)
      : [];

  const subscriptionDocs = Array.isArray(recordViewData.subscriptiondocument)
    ? recordViewData.subscriptiondocument
    : typeof recordViewData.subscriptiondocument === "string"
      ? safeJsonParse(recordViewData.subscriptiondocument)
      : [];

  const instrumentData = safeJsonParse(recordViewData.instrument_type_data);
  const founderData = safeJsonParse(recordViewData.founder_data);

  // Check if this is Round 0
  const isRound0 = recordViewData.round_type === "Round 0";

  console.log("View Record Data:", recordViewData);
  console.log("Parsed Founder Data:", founderData);
  console.log("Parsed Instrument Data:", instrumentData);

  // Function to render Round 0 specific content
  const renderRound0Content = () => (
    <div className="round-0-special-section">
      <div className="alert alert-info mb-3">
        <strong>Round 0 - Incorporation Details</strong>
        <p className="mb-0 small">Founder shares issued at incorporation</p>
      </div>

      <div className="row g-3">
        {/* Round Name */}
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Name of Round:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.nameOfRound || "Founding Share Allocation"}
            </p>
          </div>
        </div>

        {/* Share Class Type */}
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Share Class Type:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.shareClassType || "Common Shares"}
            </p>
          </div>
        </div>

        {/* Price Per Share */}
        {founderData.pricePerShare && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Price Per Share:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                ${founderData.pricePerShare}
              </p>
            </div>
          </div>
        )}

        {/* Total Shares */}
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Total Shares Issued:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.issuedshares ?
                Number(recordViewData.issuedshares).toLocaleString("en-US") :
                (founderData.totalShares || 0).toLocaleString()
              }
            </p>
          </div>
        </div>

        {/* Total Valuation */}
        {founderData.totalValue && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Total Incorporation Value:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                ${founderData.totalValue}
              </p>
            </div>
          </div>
        )}

        {/* Number of Founders */}
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Number of Founders:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.founder_count || (founderData.founders ? founderData.founders.length : 0)}
            </p>
          </div>
        </div>

        {/* Founder Allocation Details */}
        {founderData.founders && founderData.founders.length > 0 && (
          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Founder Share Allocation:
              </span>
              <div className="table-responsive mt-2">
                <table className="table table-sm table-bordered">
                  <thead>
                    <tr>
                      <th>Founder</th>
                      <th>Shares</th>
                      <th>Share Type</th>
                      <th>Voting Rights</th>
                      <th>Ownership %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {founderData.founders.map((founder, index) => {
                      const shares = parseInt(founder.shares) || 0;
                      const totalShares = founderData.totalShares || recordViewData.total_founder_shares || 1;
                      const percentage = totalShares > 0 ?
                        ((shares / totalShares) * 100).toFixed(1) : '0.0';

                      return (
                        <tr key={index}>
                          <td>Founder {index + 1}</td>
                          <td>{shares.toLocaleString()}</td>
                          <td>
                            {founder.shareType === 'common' ? 'Common Shares' :
                              founder.shareType === 'preferred' ? 'Preferred Shares' :
                                founder.shareType === 'other' ? 'Other' : 'Common Shares'}
                          </td>
                          <td>{founder.voting === 'voting' ? 'Voting' : 'Non-Voting'}</td>
                          <td>{percentage}%</td>
                        </tr>
                      );
                    })}
                    <tr className="table-secondary fw-bold">
                      <td>Total</td>
                      <td>{(founderData.totalShares || recordViewData.total_founder_shares || 0).toLocaleString()}</td>
                      <td>-</td>
                      <td>-</td>
                      <td>100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Description */}
        {recordViewData.description && (
          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Description:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {recordViewData.description}
              </p>
            </div>
          </div>
        )}

        {/* Rights */}
        {recordViewData.rights && (
          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Founder Rights & Preferences:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {recordViewData.rights}
              </p>
            </div>
          </div>
        )}

        {/* Voting Rights */}
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Voting Rights:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.voting || "Yes"}
            </p>
          </div>
        </div>

        {/* Convertible */}
        {recordViewData.convertible && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Shares Convertible:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {recordViewData.convertible}
                {recordViewData.convertible === "Yes" && recordViewData.convertibleType &&
                  ` (${recordViewData.convertibleType})`
                }
              </p>
            </div>
          </div>
        )}

        {/* General Notes */}
        {recordViewData.generalnotes && (
          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Additional Notes:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {recordViewData.generalnotes}
              </p>
            </div>
          </div>
        )}

        {/* Note about Round 0 */}
        <div className="col-12">
          <div className="p-3 bg-warning bg-opacity-10 rounded-3">
            <small className="text-muted">
              <strong>Note:</strong> Round 0 represents company incorporation.
              Total shares will carry forward to future rounds, but price per share
              will be recalculated based on investment terms.
            </small>
          </div>
        </div>
      </div>
    </div>
  );

  // Function to render regular investment round content
  const renderInvestmentRoundContent = () => (
    <div className="row g-3">
      {/* Share Class Information */}
      <div className="col-md-6">
        <div className="p-3 bg-light rounded-3 h-100">
          <span className="text-secondary small fw-semibold text-uppercase">
            Name of Round:
          </span>
          <p className="mb-0 mt-1 fw-medium text-dark fs-6">
            {recordViewData.nameOfRound || (
              <span className="text-muted">Not provided</span>
            )}
          </p>
        </div>
      </div>

      <div className="col-md-6">
        <div className="p-3 bg-light rounded-3 h-100">
          <span className="text-secondary small fw-semibold text-uppercase">
            Share Class Type:
          </span>
          <p className="mb-0 mt-1 fw-medium text-dark fs-6">
            {recordViewData.shareClassType || (
              <span className="text-muted">Not provided</span>
            )}
          </p>
        </div>
      </div>

      {recordViewData.shareclassother && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Custom Share Class Name:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.shareclassother}
            </p>
          </div>
        </div>
      )}

      {/* Description */}
      {recordViewData.description && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Description:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.description}
            </p>
          </div>
        </div>
      )}

      {/* Investment Instrument */}
      {recordViewData.instrumentType && (
        <>
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Investment Instrument:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {recordViewData.instrumentType}
              </p>
            </div>
          </div>

          {recordViewData.customInstrument && (
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Custom Investment Instrument:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.customInstrument}
                </p>
              </div>
            </div>
          )}

          {/* Instrument Specific Details */}
          {renderInstrumentDetails()}
        </>
      )}

      {/* Round Size */}
      {recordViewData.roundsize && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Round Size:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.currency || '$'}{Number(recordViewData.roundsize).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {recordViewData.currency && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Currency:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.currency}
            </p>
          </div>
        </div>
      )}

      {/* Issued Shares */}
      {recordViewData.issuedshares && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Shares Issued:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {Number(recordViewData.issuedshares).toLocaleString("en-US")}
            </p>
          </div>
        </div>
      )}

      {/* Round Status */}
      {recordViewData.roundStatus && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Round Status:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.roundStatus}
              {recordViewData.roundStatus === "CLOSED" && recordViewData.dateroundclosed && (
                <span className="text-muted small d-block mt-1">
                  Closed on: {recordViewData.dateroundclosed}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Rights & Preferences */}
      {recordViewData.rights && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Rights & Preferences:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.rights}
            </p>
          </div>
        </div>
      )}

      {/* Liquidation Preferences */}
      {recordViewData.liquidationpreferences && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Liquidation Preference:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.liquidationpreferences}
            </p>
          </div>
        </div>
      )}

      {/* Liquidation Type */}
      {recordViewData.liquidation && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Liquidation Type:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {Array.isArray(recordViewData.liquidation) ?
                recordViewData.liquidation.join(", ") :
                recordViewData.liquidation
              }
            </p>
            {recordViewData.liquidationOther && (
              <p className="mb-0 mt-2 fw-medium text-dark">
                <strong>Custom:</strong> {recordViewData.liquidationOther}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Convertible */}
      {recordViewData.convertible && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Convertible:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.convertible}
            </p>
          </div>
        </div>
      )}

      {/* Convertible Type */}
      {recordViewData.convertibleType && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Convertible Type:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.convertibleType}
            </p>
          </div>
        </div>
      )}

      {/* Voting Rights */}
      {recordViewData.voting && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Voting Rights:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.voting}
            </p>
          </div>
        </div>
      )}

      {/* File Downloads */}
      {renderFileDownloads()}

      {/* General Notes */}
      {recordViewData.generalnotes && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              General Notes:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {recordViewData.generalnotes}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  // Function to render instrument-specific details
  const renderInstrumentDetails = () => {
    if (!recordViewData.instrumentType || !instrumentData) return null;

    switch (recordViewData.instrumentType) {
      case "Common Stock":
        return (
          <div className="col-12">
            <div className="p-3 border rounded bg-light">
              <h5>Common Stock Details</h5>
              <div className="row">
                {instrumentData.common_stock_valuation && (
                  <div className="col-md-6">
                    <strong>Company Valuation:</strong> ${Number(instrumentData.common_stock_valuation).toLocaleString()}
                  </div>
                )}
                <div className="col-md-6">
                  <strong>Warrants:</strong> {instrumentData.hasWarrants ? "Yes" : "No"}
                </div>
                {instrumentData.hasWarrants && (
                  <>
                    {instrumentData.exercisePrice && (
                      <div className="col-md-6">
                        <strong>Exercise Price:</strong> ${instrumentData.exercisePrice}
                      </div>
                    )}
                    {instrumentData.expirationDate && (
                      <div className="col-md-6">
                        <strong>Expiration Date:</strong> {instrumentData.expirationDate}
                      </div>
                    )}
                    {instrumentData.warrantRatio && (
                      <div className="col-md-6">
                        <strong>Warrant Ratio:</strong> {instrumentData.warrantRatio}
                      </div>
                    )}
                    {instrumentData.warrantType && (
                      <div className="col-md-6">
                        <strong>Warrant Type:</strong> {instrumentData.warrantType}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );

      case "Preferred Equity":
        return (
          <div className="col-12">
            <div className="p-3 border rounded bg-light">
              <h5>Preferred Equity Details</h5>
              <div className="row">
                {instrumentData.preferred_valuation && (
                  <div className="col-md-6">
                    <strong>Company Valuation:</strong> ${Number(instrumentData.preferred_valuation).toLocaleString()}
                  </div>
                )}
                <div className="col-md-6">
                  <strong>Warrants:</strong> {instrumentData.hasWarrants_preferred ? "Yes" : "No"}
                </div>
                {instrumentData.hasWarrants_preferred && (
                  <>
                    {instrumentData.exercisePrice_preferred && (
                      <div className="col-md-6">
                        <strong>Exercise Price:</strong> ${instrumentData.exercisePrice_preferred}
                      </div>
                    )}
                    {instrumentData.expirationDate_preferred && (
                      <div className="col-md-6">
                        <strong>Expiration Date:</strong> {instrumentData.expirationDate_preferred}
                      </div>
                    )}
                    {instrumentData.warrantRatio_preferred && (
                      <div className="col-md-6">
                        <strong>Warrant Ratio:</strong> {instrumentData.warrantRatio_preferred}
                      </div>
                    )}
                    {instrumentData.warrantType_preferred && (
                      <div className="col-md-6">
                        <strong>Warrant Type:</strong> {instrumentData.warrantType_preferred}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );

      case "Safe":
        return (
          <div className="col-12">
            <div className="p-3 border rounded bg-light">
              <h5>SAFE Details</h5>
              <div className="row">
                {instrumentData.valuationCap && (
                  <div className="col-md-6">
                    <strong>Valuation Cap:</strong> ${Number(instrumentData.valuationCap).toLocaleString()}
                  </div>
                )}
                {instrumentData.discountRate && (
                  <div className="col-md-6">
                    <strong>Discount Rate:</strong> {instrumentData.discountRate}%
                  </div>
                )}
                {instrumentData.safeType && (
                  <div className="col-md-6">
                    <strong>SAFE Type:</strong> {instrumentData.safeType === "PRE_MONEY" ? "Pre-Money" : "Post-Money"}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case "Convertible Note":
        return (
          <div className="col-12">
            <div className="p-3 border rounded bg-light">
              <h5>Convertible Note Details</h5>
              <div className="row">
                {instrumentData.valuationCap_note && (
                  <div className="col-md-6">
                    <strong>Valuation Cap:</strong> ${Number(instrumentData.valuationCap_note).toLocaleString()}
                  </div>
                )}
                {instrumentData.discountRate_note && (
                  <div className="col-md-6">
                    <strong>Discount Rate:</strong> {instrumentData.discountRate_note}%
                  </div>
                )}
                {instrumentData.maturityDate && (
                  <div className="col-md-6">
                    <strong>Maturity Date:</strong> {instrumentData.maturityDate}
                  </div>
                )}
                {instrumentData.interestRate_note && (
                  <div className="col-md-6">
                    <strong>Interest Rate:</strong> {instrumentData.interestRate_note}%
                  </div>
                )}
                {instrumentData.convertibleTrigger && (
                  <div className="col-md-6">
                    <strong>Conversion Trigger:</strong> {instrumentData.convertibleTrigger.replace(/_/g, " & ")}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case "Venture/Bank DEBT":
        return (
          <div className="col-12">
            <div className="p-3 border rounded bg-light">
              <h5>Venture/Bank Debt Details</h5>
              <div className="row">
                {instrumentData.interestRate && (
                  <div className="col-md-6">
                    <strong>Interest Rate:</strong> {instrumentData.interestRate}%
                  </div>
                )}
                {instrumentData.repaymentSchedule && (
                  <div className="col-md-6">
                    <strong>Repayment Schedule:</strong> {instrumentData.repaymentSchedule} months
                  </div>
                )}
                <div className="col-md-6">
                  <strong>Warrants:</strong> {instrumentData.hasWarrants_Bank ? "Yes" : "No"}
                </div>
                {instrumentData.hasWarrants_Bank && (
                  <>
                    {instrumentData.exercisePrice_bank && (
                      <div className="col-md-6">
                        <strong>Exercise Price:</strong> ${instrumentData.exercisePrice_bank}
                      </div>
                    )}
                    {instrumentData.exercisedate_bank && (
                      <div className="col-md-6">
                        <strong>Expiration Date:</strong> {instrumentData.exercisedate_bank}
                      </div>
                    )}
                    {instrumentData.warrantRatio_bank && (
                      <div className="col-md-6">
                        <strong>Warrant Ratio:</strong> {instrumentData.warrantRatio_bank}
                      </div>
                    )}
                    {instrumentData.warrantType_bank && (
                      <div className="col-md-6">
                        <strong>Warrant Type:</strong> {instrumentData.warrantType_bank}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Function to render file downloads
  const renderFileDownloads = () => {
    const renderFileList = (files, title, pathname) => {
      if (!files || files.length === 0) return null;

      return (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              {title}:
            </span>
            <ul className="mb-0 mt-2 ps-3">
              {files.map((file, index) => {
                const downloadUrl = `http://localhost:5000/api/${pathname}/companyRound/${file}`;
                return (
                  <li
                    key={index}
                    className="mb-1 d-flex align-items-center justify-content-between"
                  >
                    <div className="fw-medium text-dark">
                      <i className="bi bi-file-earmark-text me-2 text-primary"></i>
                      {file}
                    </div>
                    <a
                      title={file}
                      href={downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-outline-danger"
                    >
                      <FaDownload /> Download
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      );
    };

    const pathname = `upload/docs/doc_${recordViewData.user_id || userLogin?.id}`;

    return (
      <>
        {renderFileList(termsheetFiles, "Term Sheet Name(s)", pathname)}
        {renderFileList(subscriptionDocs, "Subscription Document", pathname)}
      </>
    );
  };

  return (
    <div className="main_popup-overlay">
      <ModalContainer style={{ maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
        <CloseButton onClick={onClose}>×</CloseButton>

        <div className="previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm">
          <div className="d-flex align-items-center mb-3 pb-2 border-bottom">
            <div
              style={{ width: "45px", height: "45px" }}
              className="bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 p-1 rounded-circle me-3"
            >
              <VscOpenPreview />
            </div>
            <div className="d-flex align-items-center justify-content-between gap-3 w-100">
              <h3 className="mb-0 fw-semibold text-dark">
                {isRound0 ? "Round 0 - Incorporation Details" : "Investment Round Details"}
              </h3>
              <button
                type="button"
                className="bg-transparent text-danger p-1 border-0"
                onClick={onClose}
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>
          </div>

          {isRound0 ? renderRound0Content() : renderInvestmentRoundContent()}
        </div>

        <ButtonGroup className="d-flex gap-2">
          <ModalBtn onClick={onClose} className="close_btn w-fit">
            Close
          </ModalBtn>
        </ButtonGroup>
      </ModalContainer>
    </div>
  );
};

export default ViewRecordRound;