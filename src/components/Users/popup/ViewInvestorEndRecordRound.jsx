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
const ViewInvestorEndRecordRound = ({ onClose, recordViewData }) => {
  console.log(recordViewData);
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const termsheetFiles = Array.isArray(recordViewData.termsheetFile)
    ? recordViewData.termsheetFile
    : typeof recordViewData.termsheetFile === "string"
      ? JSON.parse(recordViewData.termsheetFile)
      : [];
  const subscriptionDocs = Array.isArray(recordViewData.subscriptiondocument)
    ? recordViewData.subscriptiondocument
    : typeof recordViewData.subscriptiondocument === "string"
      ? JSON.parse(recordViewData.subscriptiondocument)
      : [];
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
    <div className="main_popup-overlay">
      <ModalContainer>
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
              <h3 className="mb-0 fw-semibold text-dark">View Record</h3>
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
            <>
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Access Status:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {recordViewData.access_status || (
                      <span className="text-muted">Not provided</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Date Viewed:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {formatCurrentDate(recordViewData.date_view) || (
                      <span className="text-muted">Not provided</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Name of Round:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {recordViewData.nameOfRound}{" "}
                    {recordViewData.shareClassType || (
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
                    {<span className="text-muted">Not provided</span>}
                  </p>
                </div>
              </div>
              {recordViewData.shareclassother === "OTHER" && (
                <div className="col-md-6">
                  <div className="p-3 bg-light rounded-3 h-100">
                    <span className="text-secondary small fw-semibold text-uppercase">
                      Custom Share Class Name:
                    </span>
                    <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                      {recordViewData.shareclassother || (
                        <span className="text-muted">Not provided</span>
                      )}
                    </p>
                  </div>
                </div>
              )}
            </>

            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Description:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.description || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            <>
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Investment Instrument:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {recordViewData.instrumentType || (
                      <span className="text-muted">Not provided</span>
                    )}
                  </p>
                </div>
              </div>
              {recordViewData.instrumentType === "OTHER" && (
                <div className="col-md-6">
                  <div className="p-3 bg-light rounded-3 h-100">
                    <span className="text-secondary small fw-semibold text-uppercase">
                      Custom Investment Instrument Name:
                    </span>
                    <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                      {recordViewData.customInstrument || (
                        <span className="text-muted">Not provided</span>
                      )}
                    </p>
                  </div>
                </div>
              )}
              {recordViewData.instrumentType === "Preferred Equity" &&
                (() => {
                  let preferredData = {};

                  try {
                    // First parse turns it into a JSON string
                    const jsonString = JSON.parse(
                      recordViewData.instrument_type_data
                    );
                    // Second parse converts it into an object
                    preferredData = JSON.parse(jsonString);
                  } catch (error) {
                    console.error(
                      "Error parsing preferred equity data:",
                      error
                    );
                    preferredData = {};
                  }

                  return (
                    <div className="mt-3 p-3 border rounded bg-light">
                      <h5>Preferred Equity Details</h5>

                      {/* Preferred Valuation */}
                      <label className="form-label">Preferred Valuation</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {preferredData.preferred_valuation || (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      {/* Warrants Optional */}
                      <label className="form-label">
                        Add Warrants (optional)
                      </label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {preferredData.hasWarrants_preferred ? "Yes" : "No"}
                      </p>

                      {preferredData.hasWarrants_preferred && (
                        <>
                          {/* Exercise Price */}
                          <label className="form-label">
                            Exercise Price (Strike Price)
                          </label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {preferredData.exercisePrice_preferred || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          {/* Expiration Date */}
                          <label className="form-label">Expiration Date</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {preferredData.expirationDate_preferred || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          {/* Warrant Ratio */}
                          <label className="form-label">Warrant Ratio</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {preferredData.warrantRatio_preferred || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          {/* Type of Warrant */}
                          <label className="form-label">Type of Warrant</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {preferredData.warrantType_preferred || "PUT"}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })()}
              {recordViewData.instrumentType === "Common Stock" &&
                (() => {
                  let data = {};
                  try {
                    if (recordViewData.instrument_type_data) {
                      let parsedData = recordViewData.instrument_type_data;

                      // If it's a string, parse it
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      // If the result is still a string (double-encoded), parse again
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      data = parsedData;
                      console.log("Parsed common stock data:", data);
                    }
                  } catch (error) {
                    console.error("Error parsing common stock data:", error);
                    data = {};
                  }

                  return (
                    <div className="mt-3 p-3 border rounded bg-light">
                      <h5>Common Stock Details</h5>

                      <label className="form-label">Company Valuation</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.common_stock_valuation || (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">
                        Add Warrants (optional)
                      </label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.hasWarrants ? "Yes" : "No"}
                      </p>

                      {data.hasWarrants && (
                        <>
                          <label className="form-label">
                            Exercise Price (Strike Price)
                          </label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.exercisePrice || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          <label className="form-label">Expiration Date</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.expirationDate || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          <label className="form-label">Warrant Ratio</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.warrantRatio || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          <label className="form-label">Type of Warrant</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.warrantType || "CALL"}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })()}
              {recordViewData.instrumentType === "Convertible Note" &&
                (() => {
                  let data = {};
                  try {
                    if (recordViewData.instrument_type_data) {
                      let parsedData = recordViewData.instrument_type_data;

                      // If it's a string, parse it
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      // If the result is still a string (double-encoded), parse again
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      data = parsedData;
                      console.log("Parsed convertible note data:", data);
                    }
                  } catch (error) {
                    console.error(
                      "Error parsing convertible note data:",
                      error
                    );
                    data = {};
                  }

                  return (
                    <div className="mt-3 p-3 border rounded bg-light">
                      <h5>Convertible Note Details</h5>

                      <label className="form-label">Valuation Cap</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.valuationCap_note || (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">Discount Rate (%)</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.discountRate_note ? (
                          `${data.discountRate_note}%`
                        ) : (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">Interest Rate (%)</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.interestRate_note ? (
                          `${data.interestRate_note}%`
                        ) : (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">Maturity Date</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.maturityDate || (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">Convertible Trigger</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.convertibleTrigger ? (
                          data.convertibleTrigger.replace(/_/g, " & ")
                        ) : (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>
                    </div>
                  );
                })()}
              {recordViewData.instrumentType === "Safe" &&
                (() => {
                  let data = {};
                  try {
                    if (recordViewData.instrument_type_data) {
                      let parsedData = recordViewData.instrument_type_data;

                      // If it's a string, parse it
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      // If the result is still a string (double-encoded), parse again
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      data = parsedData;
                      console.log("Parsed Safe data:", data);
                    }
                  } catch (error) {
                    console.error("Error parsing Safe data:", error);
                    data = {};
                  }

                  return (
                    <div className="mt-3 p-3 border rounded bg-light">
                      <h5>Safe Details</h5>

                      <label className="form-label">Valuation Cap</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.valuationCap || (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">Discount Rate (%)</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.discountRate ? (
                          `${data.discountRate}%`
                        ) : (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">Safe Type</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.safeType ? (
                          data.safeType
                            .replace(/_/g, "-")
                            .toLowerCase()
                            .replace(/\b\w/g, (l) => l.toUpperCase())
                        ) : (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>
                    </div>
                  );
                })()}
              {recordViewData.instrumentType === "Venture/Bank DEBT" &&
                (() => {
                  let data = {};
                  try {
                    if (recordViewData.instrument_type_data) {
                      let parsedData = recordViewData.instrument_type_data;

                      // If it's a string, parse it
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      // If the result is still a string (double-encoded), parse again
                      if (typeof parsedData === "string") {
                        parsedData = JSON.parse(parsedData);
                      }

                      data = parsedData;
                      console.log("Parsed Venture/Bank DEBT data:", data);
                    }
                  } catch (error) {
                    console.error(
                      "Error parsing Venture/Bank DEBT data:",
                      error
                    );
                    data = {};
                  }

                  return (
                    <div className="mt-3 p-3 border rounded bg-light">
                      <h5>Venture/Bank DEBT Details</h5>

                      <label className="form-label">Interest Rate (%)</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.interestRate ? (
                          `${data.interestRate}%`
                        ) : (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">Repayment Schedule</label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.repaymentSchedule || (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>

                      <label className="form-label">
                        Add Warrants (optional)
                      </label>
                      <p className="mb-3 fw-medium text-dark fs-6">
                        {data.hasWarrants_Bank ? "Yes" : "No"}
                      </p>

                      {data.hasWarrants_Bank && (
                        <>
                          <label className="form-label">
                            Exercise Price (Strike Price)
                          </label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.exercisePrice_bank || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          <label className="form-label">Exercise Date</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.exercisedate_bank || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          <label className="form-label">Warrant Ratio</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.warrantRatio_bank || (
                              <span className="text-muted">Not provided</span>
                            )}
                          </p>

                          <label className="form-label">Type of Warrant</label>
                          <p className="mb-3 fw-medium text-dark fs-6">
                            {data.warrantType_bank || "CALL"}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })()}
            </>

            <>
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Target Raise Amount:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {recordViewData.roundsize ? (
                      Number(recordViewData.roundsize).toLocaleString("en-US")
                    ) : (
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
                    {recordViewData.currency || (
                      <span className="text-muted">Not provided</span>
                    )}
                  </p>
                </div>
              </div>
            </>

            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Number Of Shares:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.issuedshares ? (
                    Number(recordViewData.issuedshares).toLocaleString("en-US")
                  ) : (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Rights & Preferences:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.rights || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            <>
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Liquidation Preference Details:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {recordViewData.liquidationpreferences || (
                      <span className="text-muted">Not provided</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Liquidation Participating:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {Array.isArray(recordViewData.liquidation) &&
                      recordViewData.liquidation.length > 0 ? (
                      recordViewData.liquidation.join(", ")
                    ) : (
                      <span className="text-muted">N/A</span>
                    )}
                  </p>
                </div>
              </div>
              {recordViewData.liquidation &&
                recordViewData.liquidation.includes("OTHER") && (
                  <div className="col-md-6">
                    <div className="p-3 bg-light rounded-3 h-100">
                      <span className="text-secondary small fw-semibold text-uppercase">
                        Other:
                      </span>
                      <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                        {recordViewData.liquidationOther || (
                          <span className="text-muted">Not provided</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}
            </>

            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Shares are convertible:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.convertible || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Convertible Type:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.convertibleType || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Shareholders Voting Rights:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.voting || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            {termsheetFiles.length > 0 && (
              <div className="col-12">
                <div className="p-3 bg-light rounded-3">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Term Sheet Name(s):
                  </span>
                  <ul className="mb-0 mt-2 ps-3">
                    {termsheetFiles.map((file, index) => {
                      const pathname = `upload/docs/doc_${recordViewData.user_id}`;
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
            )}
            {subscriptionDocs.length > 0 && (
              <div className="col-12">
                <div className="p-3 bg-light rounded-3">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Subscription Document:
                  </span>
                  <ul className="mb-0 mt-2 ps-3">
                    {subscriptionDocs.map((file, index) => {
                      const pathname = `upload/docs/doc_${recordViewData.user_id}`;
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
                            href={downloadUrl}
                            target="_blank"
                            title={file}
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
            )}

            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Term Sheet Status:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.termsheet_status || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Subscription Document Status:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.subscription_status || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>
            {recordViewData.signature_status === "Yes" && (
              <div className="col-md-6">
                <div className="p-3 bg-light rounded-3 h-100">
                  <span className="text-secondary small fw-semibold text-uppercase">
                    Investor Authorize Signature:
                  </span>
                  <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                    {recordViewData.signature ? (
                      <img
                        src={recordViewData.signature}
                        alt="Investor Signature"
                        className="img-fluid mt-2"
                        style={{ maxHeight: "80px", objectFit: "contain" }}
                      />
                    ) : (
                      "No Signature Found"
                    )}
                  </p>
                </div>
              </div>
            )}
            <div className="col-md-12">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Amount Invested in this Round:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.roundsize ? (
                    Number(recordViewData.roundsize).toLocaleString("en-US")
                  ) : (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            <div className="col-md-12">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Date Invested:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {formatCurrentDate(recordViewData.created_at) || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            <div className="col-md-12">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Fully Diluted Shares at the Time of Investment:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {recordViewData.fully_diluted_shares || (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>
          </div>
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

export default ViewInvestorEndRecordRound;
