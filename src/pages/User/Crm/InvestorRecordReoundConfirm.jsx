import React, { useState, useEffect } from "react";
import DataTable from "react-data-table-component";
import TopBar from "../../../components/Users/TopBar";
import ModuleSideNav from "../../../components/Users/ModuleSideNav.jsx";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../../components/Styles/MainHeadStyles.js";
import {
  ModalContainer1,
  ModalTitle,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../../components/Styles/DataRoomStyle.js";
import { IoCloseCircleOutline } from "react-icons/io5";
import axios from "axios";
import { FaCheck, FaEye, FaEllipsisV } from "react-icons/fa"; // FontAwesome icons
import ViewInvestorEndRecordRound from "../../../components/Users/popup/ViewInvestorEndRecordRound";
import { useNavigate, useParams, Link } from "react-router-dom";
export default function InvestorRecordReoundConfirm() {
  const navigate = useNavigate();

  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const [ViewRecordRounds, setViewRecordRounds] = useState(false);
  const userLogin = JSON.parse(storedUsername);
  const [records, setrecords] = useState([]);
  const [errr, seterrr] = useState(false);
  const [recordViewData, setrecordViewData] = useState("");
  const [InvestorInfo, setInvestorInfo] = useState("");
  const [messagesuccessError, setmessagesuccessError] = useState("");
  var apiURLInvestor = "http://localhost:5000/api/user/investor/";
  document.title = "Investor Record Round Confirm";
  const { id } = useParams();
  useEffect(() => {
    checkInvestor();
    getInvestorReportCapitalRound();
  }, []);

  const checkInvestor = async () => {
    const formData = {
      company_id: userLogin.companies[0].id,
      id: id,
    };
    try {
      const generateRes = await axios.post(
        apiURLInvestor + "checkInvestorRecordround",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (generateRes.data.results.length === 0) {
        navigate("/crm/investorreport");
      } else {
        setInvestorInfo(generateRes.data.results[0]);
      }
      // setrecords(generateRes.data.results);
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [open, setOpen] = useState(false);
  const getInvestorReportCapitalRound = async () => {
    const formData = {
      company_id: userLogin.companies[0].id,
      id: id,
    };
    try {
      const resp = await axios.post(
        apiURLInvestor + "getInvestorReportCapitalRound",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      setrecords(resp.data.results);
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };

  const columns = [
    {
      name: "Share Class (Name of Round)",
      selector: (row) => row.shareClassType + " " + row.nameOfRound,
      sortable: true,
    },
    {
      name: "Number of Shares",
      selector: (row) => Number(row.roundsize).toLocaleString("en-US"),
      sortable: true,
    },

    {
      name: "Status of Round",
      selector: (row) => Number(row.issuedshares).toLocaleString("en-US"),
      sortable: true,
    },
    {
      name: "Date of Report",
      selector: (row) => formatCurrentDate(row.created_at),
      sortable: true,
    },
    {
      name: "Date Viewed",
      selector: (row) =>
        row.date_view ? formatCurrentDate(row.date_view) : "N/A",
      sortable: true,
    },
    {
      name: "View",
      cell: (row) => (
        <div className="d-flex gap-2">
          <button
            type="button"
            onClick={() => handleviewData(row)}
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline-success fw-bold"
            title="View Detail"
          >
            <FaEye /> view
          </button>
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
    {
      name: "Actions",
      cell: (row) => (
        <div className="d-flex gap-2">
          {row.report_status === "Confirm" ? (
            // Show confirmed icon instead of button
            <span className="text-success fw-bold" title="Confirmed">
              <FaCheck /> Confirmed
            </span>
          ) : (
            // Show Confirm button
            <button
              type="button"
              onClick={() => handleConfirmData(row, "Confirm")}
              rel="noopener noreferrer"
              className="btn btn-sm btn-outline-success fw-bold"
              title="Confirm Report"
            >
              Confirm
            </button>
          )}
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const handleConfirmData = async (dataa, types) => {
    //setViewRecordRounds(true);
    // setrecordViewData(dataa);

    const formData = {
      company_id: userLogin.companies[0].id,
      id: id,
      dataa: dataa,
      types: types,
    };
    try {
      const resp = await axios.post(
        apiURLInvestor + "InvestorAuthorizeConfimataion",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      getInvestorReportCapitalRound();
      setmessagesuccessError(resp.data.message);
      setTimeout(() => {
        setmessagesuccessError("");
      }, 3500);
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const handleviewData = (dataa) => {
    setViewRecordRounds(true);
    setrecordViewData(dataa);
  };
  const customStyles = {
    table: {
      style: {
        overflow: "visible !important",
        minWidth: "100%",
        boxShadow: "0px 3px 12px rgb(0 0 0 / 16%)",
        borderRadius: "12px",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#efefef !important",
        fontWeight: "600",
        fontSize: "0.9rem",
        color: "#000 !important",
        whiteSpace: "nowrap",
      },
    },
    cells: {
      style: {
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        backgroundColor: "#fff !important",
      },
    },
    rows: {
      style: {
        fontSize: "0.8rem",
        fontWeight: "500",
        "&:hover": {
          backgroundColor: "#e8f0fe",
        },
      },
      stripedStyle: {
        backgroundColor: "#f4f6f8",
      },
    },
    pagination: {
      style: {
        backgroundColor: "#fafafa",
        padding: "12px 16px",
      },
    },
  };

  const conditionalRowStyles = [
    {
      when: (row) => true, // apply to all rows
      style: {
        "&:hover": {
          backgroundColor: "var(--lightRed)", // apna hover color
        },
      },
    },
  ];

  const [searchText, setSearchText] = useState("");

  // Filter data by nameofreport (case insensitive)
  const filteredData = records.filter((item) => {
    const search = searchText.toLowerCase();

    // Combine all searchable fields into one string
    const combinedFields = `
    ${item.nameOfRound || ""}
    ${item.shareClassType || ""}
     ${item.roundsize || ""}
    ${item.issuedshares || ""}
    ${item.description || ""}
    ${item.instrumentType || ""}
    ${item.customInstrument || ""}
    ${item.roundsize || ""}
    ${item.issuedshares || ""}
    ${item.liquidationpreferences || ""}
  `.toLowerCase();

    return combinedFields.includes(search);
  });

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
  const handleDownload = async (url) => {
    window.open(url, "_blank");
  };

  //Share Report

  //Due diligence Record
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const handleOpen = () => setIsOpen(true);
  let files = [];

  // Ensure we have an array
  if (InvestorInfo.kyc_document) {
    if (Array.isArray(InvestorInfo.kyc_document)) {
      try {
        // Try parsing first element if it looks like JSON
        files = JSON.parse(InvestorInfo.kyc_document[0]);
      } catch (e) {
        // fallback: it's already an array of strings
        files = InvestorInfo.kyc_document;
      }
    } else {
      // single string case
      try {
        files = JSON.parse(InvestorInfo.kyc_document);
      } catch (e) {
        files = [InvestorInfo.kyc_document];
      }
    }
  }

  const isImage = (file) => {
    return /\.(jpg|jpeg|png|gif)$/i.test(file);
  };
  const baseUrl =
    "http://localhost:5000/api/upload/investor/inv_" + InvestorInfo.investor_id;
  return (
    <>
      <>
        <Wrapper>
          <div className="fullpage d-block">
            <div className="d-flex align-items-start gap-0">
              <ModuleSideNav
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
              />
              <div
                className={`global_view ${isCollapsed ? "global_view_col" : ""
                  }`}
              >
                <TopBar />
                <SectionWrapper className="d-block p-md-4 p-3">
                  <div className="container-fluid">
                    {messagesuccessError && (
                      <p
                        className={errr ? "mt-3 error_pop" : "success_pop mt-3"}
                      >
                        {messagesuccessError}
                      </p>
                    )}

                    {/* --- REPORT SUMMARY CARDS --- */}
                    <div className="titleroom d-flex justify-content-between align-items-center border-bottom pb-3">
                      <h3 className="text-lg font-bold mb-2">
                        Investor Report (Capital Round Documents)
                      </h3>
                    </div>

                    {/* --- SEARCH & DATA TABLE --- */}

                    <div className="d-flex flex-column justify-content-between align-items-start tb-box">
                      <style>
                        {`
                        .sc-fGlNzy.ewfgjA.datatb-report {
                          overflow: visible !important;
                        }
                      `}
                      </style>
                      <DataTable
                        customStyles={customStyles}
                        conditionalRowStyles={conditionalRowStyles}
                        columns={columns}
                        className="datatb-report"
                        data={filteredData}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                      />
                    </div>
                  </div>
                </SectionWrapper>
              </div>
            </div>
          </div>
        </Wrapper>
        {ViewRecordRounds && (
          <ViewInvestorEndRecordRound
            onClose={() => setViewRecordRounds(false)}
            recordViewData={recordViewData}
          />
        )}
        {isOpen && (
          <div className="main_popup-overlay">
            <ModalContainer1>
              <div className="d-flex align-items-center gap-3 mb-4 justify-content-between">
                <ModalTitle>View KYC/AML Documentation</ModalTitle>
                <button
                  type="button"
                  className="close_btn_global"
                  aria-label="Close"
                  onClick={() => setIsOpen(false)}
                >
                  <IoCloseCircleOutline size={24} />
                </button>
              </div>

              {/* Images container */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  maxHeight: "60vh",
                  overflowY: "auto",
                }}
              >
                {files.map((file, index) => {
                  const fileUrl = `${baseUrl}/${file}`;
                  return isImage(file) ? (
                    <img
                      key={index}
                      src={fileUrl}
                      alt={`Document ${index + 1}`}
                      style={{
                        maxWidth: "200px",
                        maxHeight: "200px",
                        objectFit: "contain",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        padding: "4px",
                        background: "#f9f9f9",
                      }}
                    />
                  ) : (
                    <a
                      key={index}
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                      style={{ margin: "5px" }}
                    >
                      Open Document {index + 1}
                    </a>
                  );
                })}
              </div>

              <ButtonGroup>
                <ModalBtn
                  onClick={() => setIsOpen(false)}
                  className="close_btn w-fit"
                >
                  Close
                </ModalBtn>
              </ButtonGroup>
            </ModalContainer1>
          </div>
        )}

        {showModal && (
          <div
            className="modal fade show"
            style={{
              display: "block",
              background: "rgba(0,0,0,0.5)",
            }}
          >
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header flex-column align-items-start">
                  <h5 className="modal-title mb-0">Reason for Not Confirm</h5>
                  <small className="text-muted">
                    (Series C Extension ssss)
                  </small>
                  <button
                    type="button"
                    className="btn-close position-absolute end-0 me-2"
                    onClick={() => setShowModal(false)}
                  ></button>
                </div>

                <div className="modal-body">
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="Enter reason..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>

                <div className="modal-footer">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() =>
                      handleConfirmData(selectedRow, "Not Confirm", reason)
                    }
                  >
                    Submit
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    </>
  );
}
