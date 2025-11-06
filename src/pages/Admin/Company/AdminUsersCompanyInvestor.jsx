import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { Modal, Button } from "react-bootstrap";
import { useNavigate, Link, useParams } from "react-router-dom";
import {
  FaEye,
  FaTrashAlt,
  FaEllipsisV,
  FaBuilding,
  FaProjectDiagram,
  FaUserTie,
} from "react-icons/fa";
import { FaArrowLeft } from "react-icons/fa";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import axios from "axios";
function AdminUsersCompanyInvestor() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const { id } = useParams();
  const apiUrl = "http://localhost:5000/api/admin/company/";
  const [records, setRecords] = useState([]);
  const [UserName, setUserName] = useState(null);
  document.title = "All Registered Companies - Admin";
  useEffect(() => {
    getUserallcompnay();
  }, []);
  const getUserallcompnay = async () => {
    let formData = {
      user_id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getUserallcompnay", formData, {
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
      name: "Company Name",
      selector: (row) => row.company_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Email",
      selector: (row) => row.company_email,
      sortable: true,
      className: "age",
    },
    {
      name: "Phone Number",
      selector: (row) => row.phone,
      sortable: true,
      className: "age",
    },
    {
      name: "Number of Employees",
      selector: (row) => row.employee_number,
      sortable: true,
      className: "age",
    },

    {
      name: "Total Signatory",
      selector: (row) => row.total_signatory,
      sortable: true,
      className: "age",
    },
    {
      name: "Actions",
      cell: (row) => (
        <div className="position-relative">
          <button
            className="btn btn-light btn-sm"
            onClick={() => toggleDropdown(row.company_id)}
            style={{
              border: "1px solid #ddd",
              borderRadius: "6px",
              padding: "4px 8px",
            }}
          >
            <FaEllipsisV />
          </button>

          {openDropdown === row.company_id && (
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
                to={`/admin/users/companies/view/${row.company_id}`}
                className="dropdown-item"
                title="Company Cap Table"
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
                <FaProjectDiagram
                  style={{ fontSize: "16px", color: "#6366f1" }}
                />
                <span>Cap Table</span>
              </Link>

              <Link
                to={`/admin/company/viewdetails/${row.company_id}`}
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
                to={`/admin/company/info/${row.company_id}`}
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
                <span>Company Info</span>
              </Link>

              <Link
                to={`/admin/company/investor-info/${row.company_id}`}
                className="dropdown-item"
                title="Investor Info"
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
                <FaUserTie style={{ fontSize: "16px", color: "#f59e0b" }} />
                <span>Investor Info</span>
              </Link>

              {/* Divider */}
              <div
                style={{
                  height: "1px",
                  backgroundColor: "#e5e7eb",
                  margin: "6px 0",
                }}
              />

              <button
                type="button"
                onClick={() => handleDelete(row.company_id)}
                className="dropdown-item"
                title="Delete Company"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#dc2626",
                  textDecoration: "none",
                  borderRadius: "6px",
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                  border: "none",
                  backgroundColor: "transparent",
                  width: "100%",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#fef2f2";
                  e.currentTarget.style.color = "#b91c1c";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#dc2626";
                }}
              >
                <FaTrashAlt style={{ fontSize: "16px" }} />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const [deleteId, setdeleteId] = useState("");
  const handleDelete = (id) => {
    setdeleteId(id);
    setShow(true);
  };
  const handleClose = () => {
    setShow(false);
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: deleteId,
    };
    try {
      const res = await axios.post(apiUrl + "deletecompany", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      setShow(false);
      getUserallcompnay();
      setsuccessMessage(respo.message);
      setTimeout(() => {
        setsuccessMessage("");
      }, 1200); // 3
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
  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const handleexportdata = () => {
    if (!records.length) return;

    // Step 1: Prepare the data for export
    const exportData = records.map((row) => ({
      "Company Name": row.company_name,
      "Company Email": row.company_email,
      Industory: row.company_industory,
      "Phone Number": `${row.phone}`,
      "Company Website": row.company_website,
      "Number Of Employee": row.employee_number,
      "Years Of Registration": row.year_registration,
      "One-sentence headliner about the company": row.descriptionStep4,
      "What problem are you solving": row.problemStep4,
      "What is Your Solution to the Problem": row.solutionStep4,
      Street: row.company_street_address,
      Country: row.company_country,
      "State / Province / Territory / District": row.company_state,
      City: row.city_step2,
      "Postal Code": row.company_postal_code,

      "Total Signatory": row.total_signatories,
    }));

    // Step 2: Create a worksheet and workbook
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Companies");

    // Step 3: Write and download the file
    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    });

    const data = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
    });

    saveAs(data, "companies_export.xlsx");
  };

  const customStyles = {
    table: {
      style: {
        overflow: "visible",
        minWidth: "100%",
        boxShadow:
          "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
        borderRadius: "12px",
        border: "1px solid #e5e7eb",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#f9fafb",
        fontWeight: "600",
        fontSize: "13px",
        color: "#374151",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        padding: "16px 12px",
        borderBottom: "2px solid #e5e7eb",
      },
    },
    cells: {
      style: {
        padding: "14px 12px",
        fontSize: "14px",
        color: "#1f2937",
        backgroundColor: "#ffffff",
      },
    },
    rows: {
      style: {
        fontSize: "14px",
        fontWeight: "500",
        minHeight: "56px",
        transition: "background-color 0.15s ease",
        "&:not(:last-of-type)": {
          borderBottom: "1px solid #f3f4f6",
        },
        "&:hover": {
          backgroundColor: "#f9fafb",
          cursor: "pointer",
        },
      },
      stripedStyle: {
        backgroundColor: "#fafafa",
      },
    },
    pagination: {
      style: {
        backgroundColor: "#f9fafb",
        padding: "14px 16px",
        borderTop: "1px solid #e5e7eb",
        borderBottomLeftRadius: "12px",
        borderBottomRightRadius: "12px",
        fontSize: "14px",
        color: "#6b7280",
      },
      pageButtonsStyle: {
        borderRadius: "6px",
        height: "36px",
        width: "36px",
        padding: "8px",
        margin: "0 4px",
        cursor: "pointer",
        transition: "all 0.2s",
        backgroundColor: "transparent",
        fill: "#6b7280",
        "&:disabled": {
          cursor: "not-allowed",
          fill: "#d1d5db",
        },
        "&:hover:not(:disabled)": {
          backgroundColor: "#e5e7eb",
          fill: "#374151",
        },
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
                      <div className="d-flex justify-content-between gap-2 flex-wrap mb-2">
                        <div className="d-flex align-items-center gap-3">
                          <Link
                            to={`/admin/users/company/${records?.user_id}`}
                            className="btn btn-secondary"
                          >
                            <FaArrowLeft /> Back
                          </Link>
                          <div>
                            <h5 className="mb-1"></h5>
                            <small className="text-muted">
                              Owner:{" "}
                              <b>
                                {UserName?.first_name} {UserName?.last_name}
                              </b>
                            </small>
                          </div>
                        </div>
                        <h5 className="mb-4">User All Companies</h5>
                      </div>

                      <div className="d-flex justify-content-between flex-wrap gap-3 pb-3 align-items-center">
                        <div className="d-flex justify-content-end flex-wrap  align-items-end">
                          <div class="search-bar">
                            <input
                              type="text"
                              placeholder="Search by name or email..."
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
                        <button
                          type="button"
                          onClick={handleexportdata}
                          className="admin_btn"
                        >
                          Export to Excel
                        </button>
                      </div>
                      <DataTable
                        columns={columns}
                        data={filteredRecords}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        customStyles={customStyles}
                        className="custom-scrollbar"
                        paginationPerPage={10}
                        paginationRowsPerPageOptions={[10, 20, 30, 50]}
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
            </section>
          </div>
        </div>
      </div>
      <Modal show={show} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Are you sure you want to delete this record? This action will
            permanently delete all associated data and cannot be undone.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirmDelete}>
            Confirm Delete
          </Button>
        </Modal.Footer>
      </Modal>
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
export default AdminUsersCompanyInvestor;
