import React, { useState, useEffect } from "react";
import Sidebar from "../../components/Admin/Sidebar";
import TopBar from "../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { Modal, Button } from "react-bootstrap";
import { useNavigate, Link } from "react-router-dom";
import { FaEye, FaTrashAlt, FaGift, FaShareAlt } from "react-icons/fa";

import SuccessAlert from "../../components/Admin/SuccessAlert";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import axios from "axios";
function AdminUsers() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  document.title = "All User - Admin";
  useEffect(() => {
    getallusers();
  }, []);
  const getallusers = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getallusers", formData, {
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
      name: "Phone Number",
      selector: (row) => row.phone_number,
      sortable: true,
      className: "age",
    },
    {
      name: "Account Status",
      selector: (row) => row.status,
      sortable: true,
      className: "age",
    },

    {
      name: "Total Company",
      selector: (row) => row.total_company,
      sortable: true,
      className: "age",
    },

    {
      name: "Action",
      cell: (row) => (
        <>
          <div className="d-flex align-items-center gap-2">
            {row.discount_code ? (
              <Link
                className="fs-5 dataedit_btn"
                target="_blank"
                to={`/admin/company/referralused/${row.discount_code}/${row.id}`}
                title="Referral Codes Used"
              >
                <FaGift />
              </Link>
            ) : (
              <span className="text-muted"></span>
            )}
            {/**<Link
              to={`/admin/company/referralcompany/${row.id}`}
              title="Referral Company"
              className="fs-5"
            >
              <HiOutlineUserAdd />
            </Link> **/}
            {/* <Link
              className=" fs-5 dataedit_btn"
              target="_blank"
              to={`/admin/company/sharedreferral/${row.id}`}
              title="Shared Referral Code"
            >
              <FaShareAlt />
            </Link> */}
            <Link
              to={`/admin/users/company/${row.id}`}
              className="fs-5 dataedit_btn"
            >
              <FaEye />
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(row.id)}
              className="deleteedit_btn border-0 fs-5"
              title="Delete"
            >
              <FaTrashAlt />
            </button>
          </div>
        </>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
      width: "150px",
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
      const res = await axios.post(apiUrl + "deleteUsers", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      setShow(false);
      getallusers();
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
  const filteredRecords = records.filter((record) => {
    const search = searchQuery.toLowerCase();

    return (
      (record.first_name?.toLowerCase() || "").includes(search) ||
      (record.last_name?.toLowerCase() || "").includes(search) ||
      (record.phone_number?.toLowerCase() || "").includes(search) ||
      (record.status?.toLowerCase() || "").includes(search) ||
      // Convert to string before toLowerCase
      String(record.total_company || "")
        .toLowerCase()
        .includes(search)
    );
  });

  //Subscription View
  const handleViewsubscriptionList = (id) => { };
  //Subscription View

  const handleexportdata = () => {
    if (!records.length) return;

    // Step 1: Prepare the data for export
    const exportData = records.map((row) => ({
      "Company Name": row.company_name,
      "Phone Number": `${row.phone}`,
      "Number Of Employee": row.employee_number,
      "Company Website": row.company_website,
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
        minWidth: "100%",
        boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
        border: "1px solid #00000036",
        borderRadius: "12px",
        overflow: "hidden",
        display: "block",
      },
    },
    headRow: {
      style: {
        display: "grid",
        gridTemplateColumns:
          "minmax(150px, 1fr) minmax(150px, 1fr) minmax(200px, 1fr) minmax(120px, 1fr) 80px 150px",
        backgroundColor: "#ff3f45",
        color: "#fff",
        fontWeight: "600",
        fontSize: "12px",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      },
    },
    headCells: {
      style: {
        padding: "8px",
        textAlign: "left",
      },
    },
    rows: {
      style: {
        display: "grid",
        gridTemplateColumns:
          "minmax(150px, 1fr) minmax(150px, 1fr) minmax(200px, 1fr) minmax(120px, 1fr) 80px 150px",
        fontSize: "14px",
        "&:hover": {
          backgroundColor: "#e8f0fe",
        },
      },
      stripedStyle: {
        backgroundColor: "#f4f6f8",
      },
    },
    cells: {
      style: {
        whiteSpace: "normal",
        overflow: "hidden",
        textOverflow: "ellipsis",
        padding: "8px",
        display: "flex",
        alignItems: "center",
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
                        <h5 className="mb-3">Users</h5>
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
                      <DataTable
                        columns={columns}
                        data={filteredRecords}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        customStyles={customStyles}
                        className="custom-scrollbar custome-icon"
                        noDataComponent={
                          <div className="text-center py-2">
                            <span>No users found</span>
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

export default AdminUsers;
