import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Link } from "react-router-dom";
import DataTable from "react-data-table-component";
import { FaPlus } from "react-icons/fa6";
import { Modal, Button } from "react-bootstrap";
import { FaTrashAlt, FaEdit, FaShareAlt, FaUserCheck } from "react-icons/fa";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import CompanyShareReferal from "../../../components/Admin/popup/CompanyShareReferal";
function AdminDiscountCode() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [getDataroompay, setgetDataroompay] = useState("");
  useEffect(() => {
    document.title = "Discount Code - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [searchQuery, setSearchQuery] = useState("");
  const [DiscountCode, setDiscountCode] = useState([]);
  const [CodeId, setCodeId] = useState("");
  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );
  useEffect(() => {
    getDataroompayment();
  }, []);
  const getDataroompayment = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getDataroompayment", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.row;
      setgetDataroompay(respo[0]);
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
  const [successMessage, setsuccessMessage] = useState("");
  const [show, setShow] = useState(false);
  const [Deleteid, setDeleteid] = useState("");
  const [SharedDiscount, setSharedDiscount] = useState(false);
  const handleDelete = async (id) => {
    setDeleteid(id);
    setShow(true);
  };
  const columns = [
    {
      name: "Code",
      selector: (row) => row.code,
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
      name: "Status",
      selector: (row) => {
        const today = new Date();
        const expiry = new Date(row.exp_date);

        // Strip time from both for date-only comparison
        today.setHours(0, 0, 0, 0);
        expiry.setHours(0, 0, 0, 0);

        return expiry < today ? "Inactive" : "Active";
      },
      sortable: true,
      className: "age",
    },
    {
      name: "Share",
      selector: (row) => row.shared,
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
      name: "Action",
      cell: (row) => {
        const today = new Date();
        const expiry = new Date(row.exp_date);
        today.setHours(0, 0, 0, 0);
        expiry.setHours(0, 0, 0, 0);

        const isInactive = expiry < today;

        return (
          <div className="d-flex align-items-center gap-2">
            <Link
              className="dataedit_btn fs-5"
              to={`/admin/setting/referralcodes/${row.code}`}
              title="Referral Codes"
            >
              <FaUserCheck />
            </Link>
            {/* <Link
              className="dataedit_btn fs-5"
              to={`/admin/setting/referralusage/${row.code}`}
              title="Referral Usage"
            >
              <FaUserCheck />
            </Link> */}

            {/* Share button with disable effect if inactive */}
            <Link
              className="dataedit_btn fs-5"
              to="javascript:void(0)"
              onClick={() => !isInactive && handleShareCode(row.code, row.id)}
              title="Share"
              style={{
                pointerEvents: isInactive ? "none" : "auto",
                opacity: isInactive ? 0.5 : 1,
              }}
            >
              <FaShareAlt />
            </Link>

            <Link
              className="dataedit_btn fs-5"
              to={`/admin/setting/discountCode/edit/${row.id}`}
              title="Edit"
            >
              <FaEdit />
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
        );
      },
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
      width: "220px",
    },
  ];

  useEffect(() => {
    getdiscountCode();
  }, []);
  const getdiscountCode = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getdiscountCode", formData, {
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
  const [RowId, setRowId] = useState("");
  const handleShareCode = (cod, cid) => {
    setCodeId(cod);
    setRowId(cid);
    setSharedDiscount(true);
  };
  const handleClose = () => {
    setShow(false);
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: Deleteid,
    };
    try {
      const res = await axios.post(apiUrl + "deletediscountcode", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      setShow(false);
      getdiscountCode();
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
  const returnrefresh = () => { };

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
                    <div className="card p-4">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}
                      <div className="d-flex justify-content-between">
                        <h5 className="mb-3">Discount Code</h5>
                      </div>
                      <div className="d-flex justify-content-between flex-wrap gap-3 pb-3 align-items-center">
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
                        <Link
                          to="/admin/setting/createpaymentdiscount"
                          className="admin_btn"
                        >
                          Add Code <FaPlus />
                        </Link>
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
                          <div className="text-center">
                            <span>No results found</span>
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
          <p>Are you sure you want to delete this record?</p>
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
      {SharedDiscount && (
        <CompanyShareReferal
          onClose={() => setSharedDiscount(false)}
          codeid={CodeId}
          returnrefresh={returnrefresh}
          RowId={RowId}
        />
      )}
    </>
  );
}

export default AdminDiscountCode;
