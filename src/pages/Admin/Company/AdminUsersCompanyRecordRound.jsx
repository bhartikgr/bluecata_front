import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { useNavigate, Link, useParams } from "react-router-dom";
import { FaEye, FaEllipsisV } from "react-icons/fa";
import axios from "axios";
import AdminCompanyTopbar from "../../../components/Admin/company/AdminCompanyTopbar";
import AdminCompanyRecordRound from "../../../components/Admin/company/AdminCompanyRecordRound";
function AdminUsersCompanyRecordRound() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const { id } = useParams();
  const apiUrl = "http://localhost:5000/api/admin/company/";
  const [records, setRecords] = useState([]);
  const [UserName, setUserName] = useState(null);
  document.title = "Company Record Round - Admin";
  useEffect(() => {
    getCompnayRecordRound();
  }, []);
  const getCompnayRecordRound = async () => {
    let formData = {
      company_id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getCompnayRecordRound", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      if (respo.length > 0) {
        setUserName(respo[0]);
      }
      setRecords(respo);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  const [openDropdown, setOpenDropdown] = useState(null);

  const toggleDropdown = (id) => {
    // If the clicked row is already open, close it; otherwise open it
    setOpenDropdown(openDropdown === id ? null : id);
  };
  const columns = [
    {
      name: "Name of Round",
      selector: (row) => row.nameOfRound + " " + row.shareClassType,
      sortable: true,
      className: "age",
    },
    {
      name: "Target Raise Amount",
      selector: (row) => {
        const amount = row.roundsize ? Number(row.roundsize) : 0;
        const currency = row.currency || ""; // e.g., ₹ or $
        const formattedAmount = amount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        return `${currency} ${formattedAmount}`;
      },
      sortable: true,
    },
    {
      name: "Number of Shares",
      selector: (row) => {
        const formattedAmount = Number(row.issuedshares).toLocaleString(
          "en-IN",
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        );
        return `${formattedAmount}`;
      },
      sortable: true,
    },

    {
      name: "Status of Round",
      selector: (row) => row.dateroundclosed,
      sortable: true,
      cell: (row) => {
        const isActive = row.roundStatus === "ACTIVE";
        const displayText = isActive
          ? "ACTIVE"
          : `CLOSED: ${formatCurrentDate(row.dateroundclosed)}`;

        return (
          <span
            style={{
              padding: "4px 12px",
              borderRadius: "12px",
              fontWeight: "600",
              color: isActive ? "#065f46" : "#b91c1c", // green or red text
              backgroundColor: isActive ? "#d1fae5" : "#fee2e2", // green or red bg
              fontSize: "12px",
              display: "inline-block",
            }}
          >
            {displayText}
          </span>
        );
      },
    },
    {
      name: "Actions",
      cell: (row) => (
        <div className="position-relative">
          <button
            className="block bg-transprent border-0"
            onClick={() => toggleDropdown(row.id)}
          >
            <FaEllipsisV />
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
                to="javascript:void(0)"
                onClick={() => handleclickRecordRound(row.id)}
                className="dropdown-item"
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
            </div>
          )}
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
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

  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

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
  const [showModal, setShowModal] = useState(false);
  const [ReportId, setReportId] = useState("");
  const handleclickRecordRound = (rep_id) => {
    setReportId(rep_id);
    setShowModal(true); // ✅ open modal
  };

  const handleCloseModal = () => {
    setShowModal(false); // ✅ close modal
  };
  return (
    <>
      <div>
        <div className="d-flex align-items-start gap-0">
          <Sidebar />
          <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <AdminCompanyTopbar id={id} />
                  <div className="col-12">
                    <div className="card p-3">
                      <div className="d-flex justify-content-between flex-wrap gap-3 pb-3 align-items-center">
                        <div className="d-flex justify-content-end flex-wrap  align-items-end">
                          <div class="search-bar">
                            <input
                              type="text"
                              placeholder="Search..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <span class="search-icon">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                                />
                              </svg>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="d-flex  flex-column justify-content-between align-items-start tb-box">
                        <style>
                          {`
                        .datatb-report {
                          overflow: visible !important;
                        }
                      `}
                        </style>
                        <DataTable
                          columns={columns}
                          data={filteredRecords}
                          pagination
                          highlightOnHover
                          striped
                          responsive
                          customStyles={customStyles}
                          className="custom-scrollbar datatb-report"
                          paginationPerPage={10}
                          paginationRowsPerPageOptions={[10, 25, 50, 100]}
                          paginationComponentOptions={{
                            rowsPerPageText: "Rows per page:",
                            rangeSeparatorText: "of",
                            noRowsPerPage: false,
                            selectAllRowsItem: false,
                          }}
                          noDataComponent={
                            <div
                              style={{
                                padding: "48px 24px",
                                textAlign: "center",
                                color: "#6b7280",
                                fontSize: "14px",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: "48px",
                                  marginBottom: "12px",
                                  opacity: 0.3,
                                }}
                              >
                                📋
                              </div>
                              <p style={{ margin: 0, fontWeight: 500 }}>
                                No companies found
                              </p>
                              <p
                                style={{
                                  margin: "4px 0 0 0",
                                  fontSize: "13px",
                                  color: "#9ca3af",
                                }}
                              >
                                Try adjusting your search or filters
                              </p>
                            </div>
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      {showModal && (
        <AdminCompanyRecordRound
          ReportId={ReportId}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}
<style jsx>{`
  @keyframes fadeInDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`}</style>;
export default AdminUsersCompanyRecordRound;
