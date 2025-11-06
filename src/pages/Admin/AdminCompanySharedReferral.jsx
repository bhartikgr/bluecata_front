import React, { useState, useEffect } from "react";
import Sidebar from "../../components/Admin/Sidebar";
import TopBar from "../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { Modal, Button } from "react-bootstrap";
import { useNavigate, Link, useParams } from "react-router-dom";
import {
  FaEye,
  FaTrashAlt,
  FaGift,
  FaShareAlt,
  FaArrowLeft,
} from "react-icons/fa";
import { HiOutlineUserAdd } from "react-icons/hi";

import SuccessAlert from "../../components/Admin/SuccessAlert";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import axios from "axios";
function AdminCompanySharedReferral() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  document.title = "Shared Referral Code - Admin";
  const { id } = useParams();
  useEffect(() => {
    getcompanysharedcode();
  }, []);
  const getcompanysharedcode = async () => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getcompanysharedcode", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      console.log(respo);
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
      name: "Referral Code",
      selector: (row) => row.discount_code,
      sortable: true,
      className: "age",
    },
    {
      name: "Shared Count",
      selector: (row) => row.total_shared_codes,
      sortable: true,
      className: "age",
    },
    {
      name: "Discount",
      selector: (row) => row.percentage + "%",
      sortable: true,
      className: "age",
    },
    {
      name: "Use Limit",
      selector: (row) => row.usage_limit,
      sortable: true,
      className: "age",
    },
    {
      name: "Used Count",
      selector: (row) => row.used_count,
      sortable: true,
      className: "age",
    },

    {
      name: "Expired Date",
      selector: (row) => formatCurrentDate(row.exp_date),
      sortable: true,
      className: "age",
    },
    {
      name: "Actions",
      cell: (row) => (
        <Link
          to={`/admin/company/referralcodes/${row.discount_code}/${row.shared_id}`}
          className="fs-5 dataedit_btn"
          title="View Details"
        >
          <FaEye />
        </Link>
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
  const [deleteId, setdeleteId] = useState("");

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
  const customStyles = {
    table: {
      style: {
        minWidth: "100%",
        boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
        border: "1px solid #00000036",
        borderRadius: "12px",
        overflow: "hidden",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#ff3f45 !important",
        fontWeight: "600",
        fontSize: "12px",
        color: "#fff !important",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      },
    },
    cells: {
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "200px",
      },
    },
    rows: {
      style: {
        fontSize: "14px",
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
                    <div className="card d-flex flex-column gap-3 p-3">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}
                      <div className="d-flex align-items-end justify-content-end flex-column gap-3 w-100">
                        <div className="d-flex justify-content-between align-items-center w-100">
                          <Link
                            to={`/admin/company`}
                            className="btn btn-secondary py-2"
                            style={{ width: "fit-content" }}
                          >
                            <FaArrowLeft /> Back
                          </Link>
                          {records.length > 0 && (
                            <h5 className="mb-0">
                              Shared By ({records[0].company_name})
                            </h5>
                          )}

                          <h5 className="mb-0">Shared Referral Code</h5>
                        </div>
                        <div className="d-flex justify-content-end align-items-end">
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
                      </div>
                      <DataTable
                        columns={columns}
                        data={filteredRecords}
                        pagination
                        highlightOnHover
                        striped
                        customStyles={customStyles}
                        className="custom-scrollbar custome-icon"
                        responsive
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

export default AdminCompanySharedReferral;
