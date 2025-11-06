import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import DataTable from "react-data-table-component";
import { useNavigate } from "react-router-dom";
import { FaPlus } from "react-icons/fa6";
import { FaEdit, FaTrashAlt } from "react-icons/fa";
import { Link } from "react-router-dom";
import axios from "axios";
import { Modal, Button } from "react-bootstrap";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import DangerAlert from "../../../components/Admin/DangerAlert";
function AdminUserEmailtemplate() {
  const navigate = useNavigate();
  const [Deleteid, setDeleteid] = useState("");
  const [successMessage, setsuccessMessage] = useState("");
  const [successMessagetemplate, setsuccessMessagetemplate] = useState("");
  const [errorMessagetemplate, seterrorMessagetemplate] = useState("");
  const [show, setShow] = useState(false);
  const [showEdit, setshowEdit] = useState(false);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  const [editdata, seteditdata] = useState("");

  document.title = "Email Template - Admin";
  const [form, setForm] = useState({
    name: "",
    type: "",
    subject: "",
    body: "",
  });

  useEffect(() => {
    getemailtemplate();
  }, []);
  const getemailtemplate = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getemailtemplate", formData, {
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
      name: "Name",
      selector: (row) => row.name,
      sortable: true,
      className: "age",
    },
    {
      name: "Type",
      selector: (row) => row.type,
      sortable: true,
      className: "age",
    },
    {
      name: "Subject",
      selector: (row) => row.subject,
      sortable: true,
      className: "age",
    },

    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex align-items-center gap-3">
          <Link
            to="#"
            onClick={() => handleEdit(row.id)}
            className="dataedit_btn  border-0 fs-5"
            title="Edit Template"
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

  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );
  //Delete Zoom Meet
  const handledelete = (id) => {
    setDeleteid(id);
    setShow(true);
  };
  const handleEdit = async (id) => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(
        apiUrl + "getemailtemplateSingle",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;

      const data = respo[0];
      seteditdata(data);
      setForm({
        name: data.name || "",
        type: data.type || "",
        subject: data.subject || "",
        body: data.body || "",
      });
      setshowEdit(true);
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
    setShow(false);
    setshowEdit(false);
    setsuccessMessage("");
    setsuccessMessagetemplate("");
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: Deleteid,
    };
    try {
      const res = await axios.post(apiUrl + "emailtemplateDelete", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setsuccessMessage("The meeting has been deleted successfully.");

      setShow(false);
      setTimeout(() => {
        getemailtemplate();
        setsuccessMessage("");
      }, 1400); // 3
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
  //Email Template
  const handleEmailtemplate = () => {
    setshowEdit(true);
    seteditdata("");
    setForm({
      name: "",
      type: "",
      subject: "",
      body: "",
    });
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    let formData = {
      name: form.name,
      type: form.type,
      subject: form.subject,
      body: form.body,
      id: editdata.id,
    };
    try {
      const res = await axios.post(apiUrl + "emailtemplate", formData);
      if (res.data.status === 1) {
        setsuccessMessagetemplate(res.data.message);
        setTimeout(() => {
          window.location.reload();
          getemailtemplate();
          setsuccessMessagetemplate("");
          seterrorMessagetemplate("");
          setshowEdit(false);
        }, 1400);
      } else {
        seterrorMessagetemplate(res.data.message);
      }
    } catch (err) {
      console.error(err);
      //alert("Something went wrong");
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
                  <div className="col-12">
                    <div className="card p-3">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}
                      <div className="d-flex justify-content-between ">
                        <h5 className="mb-3">Email Template List</h5>
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
                          onClick={handleEmailtemplate}
                          to="javascript:void(0)"
                          className="admin_btn"
                        >
                          Add Template <FaPlus />
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
          <Modal.Title>
            {editdata?.id ? "Edit" : "Add"} Email Template
          </Modal.Title>
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
                  <input type="hidden" name="id" value={editdata.id} />
                  <div className="text-start">
                    <label className="form-label text-dark">
                      Template Name{" "}
                      <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      className="form-control"
                      required
                    />
                  </div>
                  <div className="text-start">
                    <label className="form-label text-dark">
                      Type <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <select
                      name="type"
                      className="form-select"
                      value={form.type}
                      onChange={(e) =>
                        setForm({ ...form, type: e.target.value })
                      }
                      required
                      disabled={!!editdata?.id}
                    >
                      <option value="">Select Type</option>
                      <option value="confirmation">Confirmation</option>
                      <option value="reminder_48hr">Reminder - 48 Hours</option>
                      <option value="reminder_24hr">Reminder - 24 Hours</option>
                      <option value="reminder_1hr">Reminder - 1 Hour</option>
                    </select>
                  </div>

                  <div className="text-start">
                    <label className="form-label text-dark">
                      Subject <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <input
                      type="text"
                      name="subject"
                      value={form.subject}
                      onChange={(e) =>
                        setForm({ ...form, subject: e.target.value })
                      }
                      className="form-control"
                      required
                    />
                  </div>

                  <div className="text-start">
                    <label className="form-label text-dark">
                      Email Body{" "}
                      <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <textarea
                      name="body"
                      rows={6}
                      value={form.body}
                      onChange={(e) =>
                        setForm({ ...form, body: e.target.value })
                      }
                      className="form-control"
                      placeholder="Hi {{user_name}}, your event {{meeting_topic}} ({{module_name}}) is scheduled on {{event_time}}. Join using: {{zoom_link}}"
                      required
                    />
                  </div>

                  <div className="d-grid">
                    {successMessagetemplate && (
                      <SuccessAlert
                        message={successMessagetemplate}
                        onClose={() => setsuccessMessagetemplate("")}
                      />
                    )}
                    {errorMessagetemplate && (
                      <DangerAlert
                        message={errorMessagetemplate}
                        onClose={() => seterrorMessagetemplate("")}
                      />
                    )}
                    <button type="submit" className="admin_btn">
                      Save Template
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

export default AdminUserEmailtemplate;
