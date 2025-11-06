// PreviousSection.js
import React from "react";
import { VscOpenPreview } from "react-icons/vsc";

const PreviousSection = ({
  formData,
  otherText,
  selected,
  visibleFields = [],
  isFirstRound = false,
  foundersData = [],
  calculateTotalShares = () => 0,
  calculateTotalValue = () => 0,
  founderCount = 0
}) => {
  const showField = (field) => visibleFields.includes(field);

  // Function to render Round 0 specific content
  const renderRound0Content = () => (
    <div className="round-0-special-section">
      <div className="alert alert-info mb-3">
        <strong>Round 0 - Incorporation Details</strong>
        <p className="mb-0 small">Founder shares issued at incorporation</p>
      </div>

      <div className="row g-3">
        {/* Round Name */}
        {showField("shareclass") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Name of Round:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.nameOfRound || "Founding Share Allocation"}
              </p>
            </div>
          </div>
        )}

        {/* Share Class Type */}
        {showField("shareclass") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Share Class Type:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.shareClassType || "Common Shares"}
              </p>
            </div>
          </div>
        )}

        {/* Price Per Share */}
        {showField("shareclass") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Price Per Share:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                ${formData.pricePerShare || "0.01"}
              </p>
            </div>
          </div>
        )}

        {/* Total Shares */}
        {showField("issuedshares") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Total Shares Issued:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.issuedshares ?
                  Number(formData.issuedshares).toLocaleString("en-US") :
                  calculateTotalShares().toLocaleString()
                }
              </p>
            </div>
          </div>
        )}

        {/* Total Valuation */}
        {showField("issuedshares") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Total Incorporation Value:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                ${calculateTotalValue()}
              </p>
            </div>
          </div>
        )}

        {/* Number of Founders */}
        {showField("shareclass") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Number of Founders:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {founderCount}
              </p>
            </div>
          </div>
        )}

        {/* Founder Allocation Details */}
        {showField("shareclass") && foundersData && foundersData.length > 0 && (
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
                    {foundersData.map((founder, index) => {
                      const shares = parseInt(founder.shares) || 0;
                      const totalShares = calculateTotalShares();
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
                    {calculateTotalShares() > 0 && (
                      <tr className="table-secondary fw-bold">
                        <td>Total</td>
                        <td>{calculateTotalShares().toLocaleString()}</td>
                        <td>-</td>
                        <td>-</td>
                        <td>100%</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Description if available */}
        {showField("description") && (
          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Description:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.description || (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Rights if available */}
        {showField("rights") && (
          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Founder Rights & Preferences:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.rights || (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Voting Rights */}
        {showField("voting") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Voting Rights:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.voting || "Yes"}
              </p>
            </div>
          </div>
        )}

        {/* Convertible if available */}
        {showField("convertible") && (
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Shares Convertible:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.convertible || "No"}
                {formData.convertible === "Yes" && formData.convertibleType &&
                  ` (${formData.convertibleType})`
                }
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
      {showField("shareclass") && (
        <>
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Name of Round:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.nameOfRound || (
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
                {selected || (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>

          {selected === "OTHER" && (
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Custom Share Class Name:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {formData.shareclassother || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {showField("description") && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Description:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {formData.description || (
                <span className="text-muted">Not provided</span>
              )}
            </p>
          </div>
        </div>
      )}

      {showField("instrument") && (
        <>
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Investment Instrument:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.instrumentType || (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>

          {formData.instrumentType === "OTHER" && (
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Custom Investment Instrument:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {formData.customInstrument || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Instrument Specific Details */}
          {formData.instrumentType === "Common Stock" && formData.common_stock_valuation && (
            <div className="col-12">
              <div className="p-3 border rounded bg-light">
                <h6>Common Stock Details</h6>
                <div className="row">
                  <div className="col-md-6">
                    <strong>Company Valuation:</strong> ${Number(formData.common_stock_valuation).toLocaleString()}
                  </div>
                  {formData.hasWarrants && (
                    <>
                      <div className="col-md-6">
                        <strong>Warrants:</strong> Yes
                      </div>
                      {formData.exercisePrice && (
                        <div className="col-md-6">
                          <strong>Exercise Price:</strong> ${formData.exercisePrice}
                        </div>
                      )}
                      {formData.expirationDate && (
                        <div className="col-md-6">
                          <strong>Expiration Date:</strong> {formData.expirationDate}
                        </div>
                      )}
                      {formData.warrantRatio && (
                        <div className="col-md-6">
                          <strong>Warrant Ratio:</strong> {formData.warrantRatio}
                        </div>
                      )}
                      {formData.warrantType && (
                        <div className="col-md-6">
                          <strong>Warrant Type:</strong> {formData.warrantType}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {formData.instrumentType === "Preferred Equity" && formData.preferred_valuation && (
            <div className="col-12">
              <div className="p-3 border rounded bg-light">
                <h6>Preferred Equity Details</h6>
                <div className="row">
                  <div className="col-md-6">
                    <strong>Company Valuation:</strong> ${Number(formData.preferred_valuation).toLocaleString()}
                  </div>
                  {formData.hasWarrants_preferred && (
                    <>
                      <div className="col-md-6">
                        <strong>Warrants:</strong> Yes
                      </div>
                      {formData.exercisePrice_preferred && (
                        <div className="col-md-6">
                          <strong>Exercise Price:</strong> ${formData.exercisePrice_preferred}
                        </div>
                      )}
                      {formData.expirationDate_preferred && (
                        <div className="col-md-6">
                          <strong>Expiration Date:</strong> {formData.expirationDate_preferred}
                        </div>
                      )}
                      {formData.warrantRatio_preferred && (
                        <div className="col-md-6">
                          <strong>Warrant Ratio:</strong> {formData.warrantRatio_preferred}
                        </div>
                      )}
                      {formData.warrantType_preferred && (
                        <div className="col-md-6">
                          <strong>Warrant Type:</strong> {formData.warrantType_preferred}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {formData.instrumentType === "Safe" && (
            <div className="col-12">
              <div className="p-3 border rounded bg-light">
                <h6>SAFE Details</h6>
                <div className="row">
                  {formData.valuationCap && (
                    <div className="col-md-6">
                      <strong>Valuation Cap:</strong> ${Number(formData.valuationCap).toLocaleString()}
                    </div>
                  )}
                  {formData.discountRate && (
                    <div className="col-md-6">
                      <strong>Discount Rate:</strong> {formData.discountRate}%
                    </div>
                  )}
                  {formData.safeType && (
                    <div className="col-md-6">
                      <strong>SAFE Type:</strong> {formData.safeType === "PRE_MONEY" ? "Pre-Money" : "Post-Money"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {formData.instrumentType === "Convertible Note" && (
            <div className="col-12">
              <div className="p-3 border rounded bg-light">
                <h6>Convertible Note Details</h6>
                <div className="row">
                  {formData.valuationCap_note && (
                    <div className="col-md-6">
                      <strong>Valuation Cap:</strong> ${Number(formData.valuationCap_note).toLocaleString()}
                    </div>
                  )}
                  {formData.discountRate_note && (
                    <div className="col-md-6">
                      <strong>Discount Rate:</strong> {formData.discountRate_note}%
                    </div>
                  )}
                  {formData.maturityDate && (
                    <div className="col-md-6">
                      <strong>Maturity Date:</strong> {formData.maturityDate}
                    </div>
                  )}
                  {formData.interestRate_note && (
                    <div className="col-md-6">
                      <strong>Interest Rate:</strong> {formData.interestRate_note}%
                    </div>
                  )}
                  {formData.convertibleTrigger && (
                    <div className="col-md-6">
                      <strong>Conversion Trigger:</strong> {formData.convertibleTrigger}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {formData.instrumentType === "Venture/Bank DEBT" && (
            <div className="col-12">
              <div className="p-3 border rounded bg-light">
                <h6>Venture/Bank Debt Details</h6>
                <div className="row">
                  {formData.interestRate && (
                    <div className="col-md-6">
                      <strong>Interest Rate:</strong> {formData.interestRate}%
                    </div>
                  )}
                  {formData.repaymentSchedule && (
                    <div className="col-md-6">
                      <strong>Repayment Schedule:</strong> {formData.repaymentSchedule} months
                    </div>
                  )}
                  {formData.hasWarrants_Bank && (
                    <>
                      <div className="col-md-6">
                        <strong>Warrants:</strong> Yes
                      </div>
                      {formData.exercisePrice_bank && (
                        <div className="col-md-6">
                          <strong>Exercise Price:</strong> ${formData.exercisePrice_bank}
                        </div>
                      )}
                      {formData.exercisedate_bank && (
                        <div className="col-md-6">
                          <strong>Expiration Date:</strong> {formData.exercisedate_bank}
                        </div>
                      )}
                      {formData.warrantRatio_bank && (
                        <div className="col-md-6">
                          <strong>Warrant Ratio:</strong> {formData.warrantRatio_bank}
                        </div>
                      )}
                      {formData.warrantType_bank && (
                        <div className="col-md-6">
                          <strong>Warrant Type:</strong> {formData.warrantType_bank}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showField("roundsize") && (
        <>
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Round Size:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.roundsize ? `${formData.currency || '$'}${Number(formData.roundsize).toLocaleString()}` : (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Currency:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.currency || (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>
        </>
      )}

      {showField("issuedshares") && (
        <>
          <div className="col-md-6">
            <div className="p-3 bg-light rounded-3 h-100">
              <span className="text-secondary small fw-semibold text-uppercase">
                Shares Issued:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.issuedshares ? (
                  Number(formData.issuedshares).toLocaleString("en-US")
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>

          {formData.roundStatus && (
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Round Status:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {formData.roundStatus}
                  {formData.roundStatus === "CLOSED" && formData.dateroundclosed && (
                    <span className="text-muted small d-block mt-1">
                      Closed on: {formData.dateroundclosed}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {showField("rights") && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Rights & Preferences:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {formData.rights || (
                <span className="text-muted">Not provided</span>
              )}
            </p>
          </div>
        </div>
      )}

      {showField("liquidation") && (
        <>
          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Liquidation Preference:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.liquidationpreferences || (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
            </div>
          </div>

          <div className="col-12">
            <div className="p-3 bg-light rounded-3">
              <span className="text-secondary small fw-semibold text-uppercase">
                Liquidation Type:
              </span>
              <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                {formData.liquidation && formData.liquidation.length > 0 ? (
                  formData.liquidation.join(", ")
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </p>
              {formData.liquidation && formData.liquidation.includes("OTHER") && formData.liquidationOther && (
                <p className="mb-0 mt-2 fw-medium text-dark">
                  <strong>Custom:</strong> {formData.liquidationOther}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {showField("convertible") && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Convertible:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {formData.convertible || (
                <span className="text-muted">Not provided</span>
              )}
            </p>
          </div>
        </div>
      )}

      {showField("convertible") && formData.convertible === "Yes" && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Convertible Type:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {formData.convertibleType || (
                <span className="text-muted">Not provided</span>
              )}
            </p>
          </div>
        </div>
      )}

      {showField("voting") && (
        <div className="col-md-6">
          <div className="p-3 bg-light rounded-3 h-100">
            <span className="text-secondary small fw-semibold text-uppercase">
              Voting Rights:
            </span>
            <p className="mb-0 mt-1 fw-medium text-dark fs-6">
              {formData.voting || (
                <span className="text-muted">Not provided</span>
              )}
            </p>
          </div>
        </div>
      )}

      {showField("termsheet") && formData.termsheetFile && formData.termsheetFile.length > 0 && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Term Sheet Files:
            </span>
            <ul className="mb-0 mt-2 ps-3">
              {formData.termsheetFile.map((file, index) => (
                <li key={index} className="mb-1 fw-medium text-dark">
                  <i className="bi bi-file-earmark-text me-2 text-primary"></i>
                  {file.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showField("subscription") && formData.subscriptiondocument && formData.subscriptiondocument.length > 0 && (
        <div className="col-12">
          <div className="p-3 bg-light rounded-3">
            <span className="text-secondary small fw-semibold text-uppercase">
              Subscription Documents:
            </span>
            <ul className="mb-0 mt-2 ps-3">
              {formData.subscriptiondocument.map((file, index) => (
                <li key={index} className="mb-1 fw-medium text-dark">
                  <i className="bi bi-file-earmark-text me-2 text-primary"></i>
                  {file.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm">
      <div className="d-flex align-items-center mb-3 pb-2 border-bottom">
        <div
          style={{ width: "45px", height: "45px" }}
          className="bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 p-1 rounded-circle me-3"
        >
          <VscOpenPreview />
        </div>
        <div>
          <h3 className="mb-0 fw-semibold text-dark">
            {isFirstRound ? "Round 0 - Incorporation Summary" : "Preview Summary"}
          </h3>
          <p className="text-muted small mb-0">
            {isFirstRound
              ? "Founder shares allocation at incorporation"
              : "Review your inputs before proceeding"}
          </p>
        </div>
      </div>

      {isFirstRound ? renderRound0Content() : renderInvestmentRoundContent()}
    </div>
  );
};

export default PreviousSection;