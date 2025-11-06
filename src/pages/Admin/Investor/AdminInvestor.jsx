import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { Modal, Button } from "react-bootstrap";
import { useNavigate, Link } from "react-router-dom";
import {
  FaEye,
  FaTrashAlt,
  FaGift,
  FaShareAlt,
  FaBuilding,
  FaFile,
} from "react-icons/fa";

import SuccessAlert from "../../../components/Admin/SuccessAlert";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import axios from "axios";
import { FaEllipsis } from "react-icons/fa6";
function AdminInvestor() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/investor/";
  const [records, setRecords] = useState([]);
  document.title = "All Investor - Admin";
  useEffect(() => {
    getallinvestor();
  }, []);
  const getallinvestor = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getallinvestor", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;

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
  const columns = [
    {
      name: "First Name",
      selector: (row) => row.first_name,
      sortable: true,
      className: "age",
    },

    {
      name: "Last Name",
      selector: (row) => row.last_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Email",
      selector: (row) => row.email,
      sortable: true,
      className: "age",
    },

    {
      name: "Account Status",
      selector: (row) => row.is_register,
      sortable: true,
      cell: (row) => {
        const isRegistered =
          row.is_register === "Yes" || row.is_register === "yes";

        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "500",
                backgroundColor: isRegistered ? "#dcfce7" : "#fee2e2",
                color: isRegistered ? "#166534" : "#991b1b",
                border: `1px solid ${isRegistered ? "#bbf7d0" : "#fecaca"}`,
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: isRegistered ? "#22c55e" : "#ef4444",
                }}
              />
              {row.is_register}
            </span>
          </div>
        );
      },
    },
    {
      name: "Total Company",
      selector: (row) => row.total_companies,
      sortable: true,
      className: "age",
    },

    {
      name: "Actions",
      cell: (row) => (
        <div className="position-relative">
          <button
            className="block bg-transprent border-0"
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
                to={`/admin/investor/viewdetails/${row.id}`}
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

              <Link
                to={`/admin/investor-info/${row.id}`}
                className="dropdown-item"
                title="Company Info"
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
                <FaBuilding style={{ fontSize: "16px", color: "#3b82f6" }} />
                <span>Investor Info</span>
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
  const [openDropdown, setOpenDropdown] = useState(null);

  const toggleDropdown = (id) => {
    // If the clicked row is already open, close it; otherwise open it
    setOpenDropdown(openDropdown === id ? null : id);
  };
  const [deleteId, setdeleteId] = useState("");
  const handleDelete = (id) => {
    setdeleteId(id);
    setShow(true);
  };

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
                  <div className="col-12">
                    <div className="card p-3">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}

                      <div className="d-flex justify-content-between">
                        <h5 className="mb-3">Investors</h5>
                      </div>
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
                                No record found
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
    </>
  );
}

export default AdminInvestor;
