// Recordround.js
import React, { useState, useEffect } from "react";
import DataTable from "react-data-table-component";
import axios from "axios";
import { API_BASE_URL } from "../../../config/config";
import { FaEllipsis, FaEye, FaLock, FaShare } from "react-icons/fa6";
import { Link } from "react-router-dom";
import ViewRecordReport from "../../../components/Users/UserSignatory/ViewRecordReport";
import ShareRecordReport from "../../../components/Users/UserSignatory/ShareRecordReport";
import { FaShareAlt } from "react-icons/fa";

const Recordround = ({ id, signatory_id }) => {
  const storedUsername = localStorage.getItem("OwnerLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [records, setrecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const apiUrlDashboard = API_BASE_URL + "api/user/signatorydashboard/";

  const [searchText, setSearchText] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    getRecordRoundList();
  }, []);

  const getRecordRoundList = async () => {
    const formData = {
      signatory_id: signatory_id,
      company_id: id,
      user_id: userLogin.id,
    };

    setLoading(true);
    try {
      const resp = await axios.post(
        apiUrlDashboard + "getRecordRoundList",
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
      console.error("Error fetching round records", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleDropdown = (id) => {
    setOpenDropdown(openDropdown === id ? null : id);
  };

  const handleClickViewDetail = (data) => {
    setSelectedRecord(data);
    setShowModal(true);
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

  const formatCurrency = (amount, currency) => {
    if (!amount) return "N/A";
    const currencySymbol =
      currency === "USD" ? "$" : currency === "EUR" ? "€" : currency || "";
    return `${currencySymbol}${parseFloat(amount).toLocaleString()}`;
  };

  const columns = [
    {
      name: "Round Name",
      selector: (row) => row.nameOfRound || "N/A",
      sortable: true,
      width: "180px",
      cell: (row) => (
        <div>
          <div className="fw-semibold">{row.nameOfRound || "N/A"}</div>
          <small className="text-muted">{row.shareClassType || ""}</small>
        </div>
      ),
    },
    {
      name: "Round Size",
      selector: (row) => row.roundsize,
      sortable: true,
      width: "140px",
      cell: (row) => (
        <div className="fw-semibold">
          {formatCurrency(row.roundsize, row.currency)}
        </div>
      ),
    },
    {
      name: "Instrument Type",
      selector: (row) => row.instrumentType || "N/A",
      sortable: true,
      width: "150px",
      cell: (row) => (
        <span className="badge bg-info">
          {row.instrumentType || row.customInstrument || "N/A"}
        </span>
      ),
    },
    {
      name: "Issued Shares",
      selector: (row) => row.issuedshares || "N/A",
      sortable: true,
      width: "120px",
      cell: (row) => (
        <span>
          {row.issuedshares
            ? parseFloat(row.issuedshares).toLocaleString()
            : "N/A"}
        </span>
      ),
    },
    {
      name: "Date Closed",
      selector: (row) => row.dateroundclosed,
      sortable: true,
      width: "150px",
      cell: (row) => formatCurrentDate(row.dateroundclosed),
    },
    {
      name: "Status",
      selector: (row) => row.roundStatus,
      sortable: true,
      width: "130px",
      center: true,
      cell: (row) => {
        const statusColors = {
          Open: "success",
          Closed: "secondary",
          "In Progress": "warning",
          Pending: "info",
        };
        const color = statusColors[row.roundStatus] || "secondary";
        return (
          <span className={`badge bg-${color}`}>
            {row.roundStatus || "N/A"}
          </span>
        );
      },
    },

    {
      name: "Actions",
      width: "80px",
      cell: (row) => (
        <div className="position-relative">
          <button
            className="btn btn-sm bg-transparent border-0"
            onClick={() => toggleDropdown(row.id)}
          >
            <FaEllipsis />
          </button>

          {openDropdown === row.id && (
            <div
              className="dropdown-menu show"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                minWidth: "200px",
                zIndex: 9999,
                borderRadius: "8px",
                boxShadow:
                  "0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)",
                backgroundColor: "#ffffff",
                padding: "6px",
                animation: "fadeInDown 0.2s ease-out",
              }}
            >
              <Link
                to="#"
                className="dropdown-item"
                onClick={() => handleClickViewDetail(row)}
                title="View Details"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#374151",
                  textDecoration: "none",
                  borderRadius: "6px",
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#374151";
                }}
              >
                <FaEye style={{ fontSize: "16px", color: "#10b981" }} />
                <span>View Details</span>
              </Link>
              <Link
                onClick={() => handleShareReport(row.id)}
                to="javascript:void(0)"
                className="dropdown-item"
                title="Share Report"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#374151",
                  textDecoration: "none",
                  borderRadius: "6px",
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#374151";
                }}
              >
                <FaShareAlt style={{ fontSize: "16px", color: "#6366f1" }} />
                <span>Share Report</span>
              </Link>
            </div>
          )}
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];

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
      when: (row) => true,
      style: {
        "&:hover": {
          backgroundColor: "#e8f0fe",
        },
      },
    },
  ];

  const filteredData =
    records?.filter((item) => {
      if (!item) return false;
      const search = searchText.toLowerCase();
      return (
        (item.nameOfRound || "").toLowerCase().includes(search) ||
        (item.shareClassType || "").toLowerCase().includes(search) ||
        (item.instrumentType || "").toLowerCase().includes(search) ||
        (item.roundStatus || "").toLowerCase().includes(search) ||
        (item.roundsize || "").toString().toLowerCase().includes(search)
      );
    }) || [];
  const [ReportId, setReportId] = useState("");
  const [showModalShareReport, setShowModalShareReport] = useState(false);
  const handleCloseModal = () => {
    setShowModal(false);
    setShowModalShareReport(false);
    setSelectedRecord(null);
  };
  const handleShareReport = (id) => {
    setReportId(id);
    setShowModalShareReport(true);
  };
  return (
    <>
      <div className="d-flex flex-column overflow-auto justify-content-between align-items-start tb-box">
        {/* Search Bar */}
        {/* <div className="w-100 mb-3">
        <input
          type="text"
          className="form-control"
          placeholder="Search by round name, type, instrument, status..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div> */}

        {/* DataTable */}
        {loading ? (
          <div className="text-center w-100 py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="mt-3 text-muted">Loading round records...</p>
          </div>
        ) : (
          <DataTable
            customStyles={customStyles}
            conditionalRowStyles={conditionalRowStyles}
            columns={columns}
            className="datatb-report"
            data={filteredData}
            pagination
            paginationPerPage={10}
            paginationRowsPerPageOptions={[5, 10, 25, 50, 100]}
            highlightOnHover
            striped
            responsive
            noDataComponent={
              <div className="text-center py-5">
                <h5 className="text-muted">No Round Records Found</h5>
                <p className="text-muted">
                  {searchText
                    ? "No records match your search criteria."
                    : "There are no round records available."}
                </p>
              </div>
            }
          />
        )}
      </div>
      {showModal && (
        <ViewRecordReport
          recordViewData={selectedRecord}
          onClose={handleCloseModal}
        />
      )}
      {showModalShareReport && (
        <ShareRecordReport ReportId={ReportId} onClose={handleCloseModal} />
      )}
    </>
  );
};

export default Recordround;
