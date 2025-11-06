import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { useNavigate } from "react-router-dom";
import { FaTrashAlt, FaEdit } from "react-icons/fa";
import { FaPlus } from "react-icons/fa6";
import { Modal, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import axios from "axios";
import { FaEye } from "react-icons/fa";
import ReactQuill from "react-quill";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import "react-quill/dist/quill.snow.css";
import { Pencil } from "lucide-react";
function AdminDuediligenceCategory() {
  const navigate = useNavigate();
  const quillRef = useRef();
  const [errorset, seterror] = useState("");
  const [contentsharing, setContentsharing] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [deleteId, setdeleteId] = useState("");
  const [showEdit, setshowEdit] = useState(false);
  const [editdata, seteditdata] = useState("");
  const [spinners, setspinnsers] = useState(false);
  const [nameval, setnameval] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  document.title = "Data Rooms Category List - Admin";
  useEffect(() => {
    getallUsersDetaillist();
  }, []);
  const getallUsersDetaillist = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getallcatgeorylist", formData, {
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
      name: "Name",
      selector: (row) => row.name,
      sortable: true,
      className: "age",
    },
    {
      name: "Total Subcategory",
      selector: (row) => row.subcategory_count,
      sortable: true,
      className: "age",
    },

    {
      name: "View",
      cell: (row) => (
        <>
          <div className="d-flex align-items-center gap-2">
            <Link
              className="dataedit_btn fs-5"
              to={`/admin/duediligencecategorytip/add/${row.id}`}
              title="View List"
            >
              <FaEye />
            </Link>
            <Link
              className="dataedit_btn fs-5"
              to={`/admin/duediligencecategory/edit/${row.id}`}
              title="Edit"
            >
              <FaEdit />
            </Link>
            <button
              onClick={() => handledelete(row.id)}
              type="button"
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
      width: "250px",
    },
  ];
  const handledelete = (id) => {
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
  const handleClose = () => {
    setShow(false);
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: deleteId,
    };
    try {
      const res = await axios.post(
        apiUrl + "dataroomcategorydelete",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;
      getallUsersDetaillist();
      setShow(false);
      setsuccessMessage(res.data.message);
      setTimeout(() => {
        setsuccessMessage("");
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
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log(contentsharing);
    let formData = {
      name: e.target.name.value,
      category_tips: contentsharing,
    };
  };
  const handleChangesharing = (value) => {
    setContentsharing(value);
  };
  const handleaddcate = () => {
    setshowEdit(true);
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
                  {successMessage && (
                    <SuccessAlert
                      message={successMessage}
                      onClose={() => setsuccessMessage("")}
                    />
                  )}
                  <div className="col-12">
                    <div className="card p-3">
                      <div className="d-flex justify-content-between">
                        <h5 className="mb-3">Data Room Category List</h5>
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
                          to="/admin/duediligencecategory/add"
                          className="admin_btn"
                        >
                          Add Catgeory <FaPlus />
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
      <Modal className="text-white" show={showEdit} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title>Add</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="row g-4">
            {successMessage && (
              <SuccessAlert
                message={successMessage}
                onClose={() => setsuccessMessage("")}
              />
            )}
            <div className="col-sm-12">
              <div className="bglight rounded h-100">
                <form
                  action="javascript:void(0)"
                  onSubmit={handleSubmit}
                  method="post"
                  className="d-flex flex-column gap-3"
                >
                  <div className=" text-start">
                    <label htmlFor="exampleInputLimits" className="form-label">
                      Name <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <input
                      type="text"
                      name="name"
                      required
                      className="form-control"
                      id="exampleInputLimits"
                    />
                  </div>
                  <div className="text-start mb-4">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      Category Tips
                    </label>
                    <ReactQuill
                      ref={quillRef}
                      value={contentsharing}
                      onChange={handleChangesharing}
                      style={{ height: "200px" }}
                      theme="snow"
                    />
                  </div>
                  <span className="text-danger mt-2">{errorset}</span>
                  <div className="d-grid mb-4">
                    <button type="submit" className="btn btn-primary">
                      Add
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

export default AdminDuediligenceCategory;
