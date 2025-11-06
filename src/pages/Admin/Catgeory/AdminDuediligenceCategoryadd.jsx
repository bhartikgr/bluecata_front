import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate, useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { IoAddOutline } from "react-icons/io5";
import DataTable from "react-data-table-component";
import { FaTrashAlt, FaEdit, FaPen, FaArrowLeft } from "react-icons/fa";
import { Pencil } from "lucide-react";
import axios from "axios";
import { FaPlus } from "react-icons/fa6";
import ReactQuill from "react-quill";
import { Modal, Button } from "react-bootstrap";

import SuccessAlert from "../../../components/Admin/SuccessAlert";
import "react-quill/dist/quill.snow.css";
function AdminDuediligenceCategoryadd() {
  const quillRef = useRef();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [spinners, setspinnsers] = useState(false);
  const [deleteId, setdeleteId] = useState("");
  const [show, setShow] = useState(false);
  const { id } = useParams();
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  useEffect(() => {
    document.title = "Data Rooms Add Sub Category - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  useEffect(() => {
    checkCatgeory();
    getvideo();
  }, [id]);
  const checkCatgeory = async () => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "checkCatgeory", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      if (respo.length === 0) {
        navigate("/admin/duediligencecategoryList");
      }
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
  const getvideo = async () => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getsubcategorylist", formData, {
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
  const [maxLimit, setMaxLimit] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");

  const handledelete = (id) => {
    setdeleteId(id);
    setShow(true);
  };
  const columns = [
    {
      name: "Name",
      selector: (row) => row.name,
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
              type="button"
              onClick={() => handleaddtip(row.id, row.tips, row.name)}
              title="Add Tip"
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
    },
  ];
  const [showEdit, setshowEdit] = useState(false);
  const [editname, seteditname] = useState("");
  const handleaddtip = (idd, tipss, name) => {
    setshowEdit(true);
    setdeleteId(idd);
    setContentsharing(tipss);
    seteditname(name);
    setsuccessMessage("");
  };
  const [errorset, seterror] = useState("");
  const handleSubmit = async (e) => {
    e.preventDefault();
    seterror("");
    console.log(contentsharing);
    let formData = {
      texttip: contentsharing,
      name: e.target.name.value,
      id: deleteId,
      dataroomid: id,
    };
    setspinnsers(true);
    try {
      const res = await axios.post(apiUrl + "savedataroomtip", formData, {
        headers: {
          Accept: "application/json",
        },
      });
      var respo = res.data.results;
      setsuccessMessage(res.data.message);
      setTimeout(() => {
        window.location.reload();
      }, 1200);
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
  const handleClose = () => {
    setshowEdit(false);
    setShow(false);
    setshowdelete(true);
    setsuccessMessage("");
  };
  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );
  const [contentsharing, setContentsharing] = useState("");
  const handleChangesharing = (value) => {
    setContentsharing(value);
  };
  const handleAddSubcat = async () => {
    setdeleteId("");
    setshowEdit(true);
    seteditname("");
    setContentsharing("");
  };
  const [showdelete, setshowdelete] = useState(false);
  const handleConfirmDelete = async () => {
    let formData = {
      id: deleteId,
    };
    try {
      const res = await axios.post(apiUrl + "deletesubcategory", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      setShow(false);
      getvideo();
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
                      <div className="d-flex flex-wrap align-items-start gap-4 justify-content-between mb-3">
                        <Link
                          to="/admin/duediligencecategoryList"
                          className="btn btn-secondary"
                        >
                          <FaArrowLeft /> Back
                        </Link>

                        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
                          <h5 className="mb-0">Data Room Sub Category</h5>
                        </div>
                      </div>
                      <div className="d-flex justify-content-between align-items-center gap-1 pb-3 flex-wrap w-100">
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
                          to="#"
                          onClick={handleAddSubcat}
                          className="admin_btn"
                        >
                          Add Sub Category <FaPlus className="ms-1" />
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
                          <div className="text-center py-2">
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
          <Modal.Title> {deleteId !== "" ? "Edit" : "Add"}</Modal.Title>
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
                  <div className="text-start w-100">
                    <label
                      htmlFor="exampleInputLimits"
                      className="form-label text-dark"
                    >
                      Name <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <input
                      type="text"
                      name="name"
                      defaultValue={editname}
                      required
                      min="1"
                      placeholder="Enter name"
                      className="form-control"
                      id="exampleInputLimits"
                    />
                  </div>
                  <div className="text-start mb-4">
                    <label
                      htmlFor="exampleInputLimit"
                      className="form-label text-dark"
                    >
                      Tip
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
                    <button type="submit" className="admin_btn">
                      Submit
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

export default AdminDuediligenceCategoryadd;
