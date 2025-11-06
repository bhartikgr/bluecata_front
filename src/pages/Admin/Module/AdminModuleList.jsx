import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { FaTrashAlt } from "react-icons/fa";
import { FaEdit } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { FaPlus } from "react-icons/fa6";
import { Modal, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import axios from "axios";
function AdminModuleList() {
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [deleteId, setdeleteId] = useState(false);
  const [showEdit, setshowEdit] = useState(false);
  const [editdata, seteditdata] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  useEffect(() => {
    document.title = "List Module - Admin";
  }, []);
  useEffect(() => {
    getmodule();
  }, []);
  const [statusval, setstatusval] = useState("");
  const [nameval, setnameval] = useState("");
  const getmodule = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getmodulelist", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      console.log(respo);
      setRecords(respo);
    } catch (err) {
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
      name: "Name",
      selector: (row) => row.name,
      sortable: true,
      className: "age",
    },
    {
      name: "Status",
      selector: (row) => row.status,
      sortable: true,
      className: "age",
    },
    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex align-items-center gap-3">
          <Link
            to={`/admin/module/edit/${row.id}`}
            className="dataedit_btn  border-0 fs-5"
            title="Edit"
          >
            <FaEdit />
          </Link>

          <button
            type="button"
            onClick={() => handledelete(row.id)}
            className="deleteedit_btn  border-0 fs-5"
            title="Delete"
          >
            <FaTrashAlt />
          </button>
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const handledelete = (id) => {
    setdeleteId(id);
    setShow(true);
  };
  const handleClose = () => {
    setShow(false);
    setshowEdit(false);
  };
  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );
  const handleConfirmDelete = async () => {
    let formData = {
      id: deleteId,
    };
    try {
      const res = await axios.post(apiUrl + "moduledelete", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      getmodule();
      setShow(false);
      setTimeout(() => {
        setsuccessMessage("Video deleted successfully");
      }, 1000); // 3
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
    // Close the modal after deletion
  };
  const [maxLimit, setMaxLimit] = useState("");
  const [file, setFile] = useState(null);
  const [filenew, setFilenew] = useState(null);
  const [error, setError] = useState("");
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    if (selectedFile) {
      const maxSize = 15 * 1024 * 1024; // 15 MB in bytes

      if (selectedFile.size > maxSize) {
        setError("File size should not exceed 15MB.");
        e.target.value = null; // clear the selected file
        setFile(null);
        setFilenew(null);
      } else {
        setError("");
        setFilenew(selectedFile);
        setFile(selectedFile);
      }
    }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();

    const form = e.target;
    let formData = {
      name: form.name.value,
      status: statusval,
      description: form.description.value,
      price: form.price.value,
      id: editdata.id,
      annual_price: form.annual_price.value,
      textt: form.textt.value,
    };
    try {
      const res = await axios.post(apiUrl + "updatelimit", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      const respo = res.data.results;
      setshowEdit(false);
      setsuccessMessage("Updated successfully");

      setTimeout(() => {
        setsuccessMessage("");
        window.location.reload();
        getmodule();
      }, 1500);
    } catch (err) {
      if (err.response) {
        console.error("Response error:", err.response.data);
      } else if (err.request) {
        console.error("Request error:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };

  const handlestatus = (e) => {
    setstatusval(e.target.value);
    console.log(e.target.value);
  };

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
                    <div className="card p-3">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}
                      <div className="d-flex justify-content-between ">
                        <h5 className="mb-3">Module List</h5>
                      </div>
                      <div className="d-flex justify-content-between flex-wrap gap-3 pb-3 align-items-center">
                        <div className="d-flex justify-content-end align-items-end">
                          <div className="search-bar">
                            <input
                              type="text"
                              placeholder="Search..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <span className="search-icon">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                                />
                              </svg>
                            </span>
                          </div>
                        </div>
                        <Link to="/admin/module/add" className="admin_btn">
                          Add <FaPlus />
                        </Link>
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
      <Modal className="text-white" show={show} onHide={handleClose}>
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

      <Modal className="text-white" show={showEdit} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title>Update</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="row g-4">
            <div className="col-sm-12">
              <div className="bglight rounded h-100">
                <form
                  action="javascript:void(0)"
                  onSubmit={handleSubmit}
                  method="post"
                  className="d-flex flex-column gap-3"
                >
                  <div className="text-start">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      Name <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <input
                      type="text"
                      defaultValue={nameval}
                      name="name"
                      required
                      min="1"
                      className="form-control"
                      id="exampleInputLimit"
                    />
                  </div>
                  <div className=" text-start">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      Status <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <select
                      className="form-control"
                      onChange={(e) => handlestatus(e)}
                      value={statusval}
                      name="status"
                      required
                    >
                      <option value="">--Select--</option>
                      <option value="Active">Active</option>
                      <option value="Inactive">In Active</option>
                    </select>
                  </div>
                  <div className="text-start">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      Description{" "}
                      <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <textarea
                      required
                      className="form-control"
                      name="description"
                      placeholder="Enter description"
                      defaultValue={editdata.description}
                    />
                  </div>
                  <div className="text-start">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      Text <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <input
                      required
                      className="form-control"
                      name="textt"
                      placeholder="Enter here..."
                      defaultValue={editdata.textt}
                    />
                  </div>
                  {/* <div className=" text-start">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      One-Time Fee
                    </label>
                    <input
                      defaultValue={editdata.price}
                      required
                      onInput={(e) => {
                        let value = e.target.value.replace(/\D/g, ""); // Remove non-digits
                        value = value.substring(0, 16); // Max 16 digits
                        value = value.replace(/(.{4})/g, "$1 ").trim(); // Add space every 4 digits
                        e.target.value = value;
                      }}
                      type="number"
                      className="form-control"
                      name="price"
                      placeholder="Enter price"
                    />
                  </div>
                  <div className=" text-start">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      Annual Fee
                    </label>
                    <input
                      onInput={(e) => {
                        let value = e.target.value.replace(/\D/g, ""); // Remove non-digits
                        value = value.substring(0, 16); // Max 16 digits
                        value = value.replace(/(.{4})/g, "$1 ").trim(); // Add space every 4 digits
                        e.target.value = value;
                      }}
                      defaultValue={editdata.annual_price}
                      type="number"
                      className="form-control"
                      name="annual_price"
                      placeholder="Enter price"
                    />
                  </div> */}
                  <div className="d-grid">
                    <button type="submit" className="btn btn-primary">
                      Update
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}

export default AdminModuleList;
