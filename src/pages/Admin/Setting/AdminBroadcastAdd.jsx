import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaTrashAlt, FaShareAlt } from "react-icons/fa";
import axios from "axios";
import "react-quill/dist/quill.snow.css";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import DangerAlert from "../../../components/Admin/DangerAlert";
import DataTable from "react-data-table-component";
import { Modal, Button } from "react-bootstrap";
function AdminBroadcastAdd() {
  const navigate = useNavigate();
  const apiUrl = "http://localhost:5000/api/admin/module/";

  const { id } = useParams("");
  useEffect(() => {
    document.title = id ? "Edit Session - Admin" : "Create Session - Admin";
  }, [id]);
  const [show, setShow] = useState(false);
  const [Deleteid, setDeleteid] = useState("");
  const [successMessage, setsuccessMessage] = useState("");
  const [errorMessage, seterrorMessage] = useState("");
  const [errorMessageShare, seterrorMessageShare] = useState("");
  const [successMessageShare, setsuccessMessageShare] = useState("");
  const [allmodule, setAllModule] = useState([]);
  const [editdata, seteditdata] = useState("");
  const [ClientIP, setClientIP] = useState("");
  const [form, setForm] = useState({
    module_id: "",
    date: "",
    meeting_id: "",
    session: "",
    status: "",
    topic: "",
    meeting_date: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    meetingLink: "",
  });
  useEffect(() => {
    const getIP = async () => {
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        setClientIP(data.ip); // Save this to state
      } catch (error) {
        console.error("Failed to fetch IP", error);
      }
    };

    getIP();
  }, []);
  useEffect(() => {
    if (id) {
      getzoomdata();
    }
  }, [id]);
  const getzoomdata = async () => {
    try {
      const res = await axios.post(apiUrl + "getsessiondata", { id: id });
      if (res.data.results.length === 0) {
        navigate("/admin/setting/broadcastsession");
      } else {
        seteditdata(res.data.results[0]);
      }
    } catch (err) {
      console.error("Error fetching modules", err);
    }
  };
  useEffect(() => {
    if (editdata) {
      const datePart = formatDate(editdata.meeting_date);
      const timePart = formatTime(editdata.time);

      setForm({
        module_id: editdata.module_id || "",
        date: editdata.date || "",
        meeting_date: `${datePart}T${timePart}`, // final format
        session: editdata.session,
        status: editdata.status,
        topic: editdata.topic,
        timezone:
          editdata.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        meetingLink: editdata.meetingLink || "",
      });
    }
  }, [editdata]);
  const formatDate = (isoDate) => {
    const dt = new Date(isoDate);
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return "00:00";
    // Handles time like "14:57:00" or "14:57"
    return timeStr.slice(0, 5); // Only keep "HH:mm"
  };

  const formatDateTimeLocal = (isoDateString) => {
    if (!isoDateString) return "";
    const dt = new Date(isoDateString);

    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    const hours = String(dt.getHours()).padStart(2, "0");
    const minutes = String(dt.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  useEffect(() => {
    getmodule();
  }, []);

  const getmodule = async () => {
    try {
      const res = await axios.post(apiUrl + "getmodulelist", { user_id: "" });
      setAllModule(res.data.results || []);
    } catch (err) {
      console.error("Error fetching modules", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    var forms = e.target;
    let formdata = {
      module_id: form.module_id,
      meeting_date: form.meeting_date,
      session: form.session,
      timezone: form.timezone,
      meetingLink: form.meetingLink,
      ip_address: ClientIP,
      status: form.status,
      topic: form.topic,
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "createzoommeetSession", formdata);
      if (res.data.status === "1") {
        setsuccessMessage(res.data.message);
        setTimeout(() => {
          //navigate("/admin/setting/broadcastsession");
          window.location.reload();
        }, 1100);
      } else {
        seterrorMessage(res.data.message);
      }
      setTimeout(() => {
        setsuccessMessage("");
        seterrorMessage("");
      }, 1200);
    } catch (err) {
      console.error(err);
    }
  };
  // Share Session Link
  const [searchQuery, setSearchQuery] = useState("");
  const [records, setrecords] = useState([]);
  const [allcompany, setallcompany] = useState([]);
  useEffect(() => {
    getallcompanises();
  }, []);
  const getallcompanises = async () => {
    let formData = { id: id };
    try {
      const res = await axios.post(apiUrl + "getallcompines", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      setallcompany(res.data.results);
    } catch (err) {
      console.error(err);
    }
  };
  const handleDeleteShared = async (id) => {
    setDeleteid(id);
    setShow(true);
  };
  const [selectedIds, setSelectedIds] = useState([]);

  const handleCheckboxChange = (id) => {
    setSelectedIds(
      (prev) =>
        prev.includes(id)
          ? prev.filter((selectedId) => selectedId !== id) // remove if already selected
          : [...prev, id] // add if not selected
    );
  };
  const columns = [
    {
      name: (
        <input
          type="checkbox"
          onChange={(e) => {
            if (e.target.checked) {
              // Select all companies where is_shared === "No"
              setSelectedIds(
                allcompany
                  .filter((row) => row.is_shared === "No")
                  .map((row) => row.id)
              );
            } else {
              setSelectedIds([]);
            }
          }}
          checked={
            selectedIds.length ===
            allcompany.filter((row) => row.is_shared === "No").length &&
            allcompany.filter((row) => row.is_shared === "No").length > 0
          }
          style={{ width: "20px", height: "20px" }} // bigger size for select all checkbox
        />
      ),
      cell: (row) => {
        const disabled = row.is_shared === "Yes";
        return (
          <input
            type="checkbox"
            checked={selectedIds.includes(row.id)}
            disabled={disabled}
            onChange={() => handleCheckboxChange(row.id)}
            style={{
              pointerEvents: disabled ? "none" : "auto",
              opacity: disabled ? 1.2 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
              width: "20px", // increase size here
              height: "20px", // increase size here
            }}
          />
        );
      },
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
      width: "60px",
    },
    {
      name: "Company Name",
      selector: (row) => row.company_name,
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
      name: "Country",
      selector: (row) => row.company_country,
      sortable: true,
      className: "age",
    },

    {
      name: "Meet Link Shared",
      selector: (row) => row.is_shared,
      sortable: true,
      cell: (row) => (
        <div
          style={{
            padding: "4px 10px",
            borderRadius: "12px",
            color: "white",
            fontWeight: "600",
            textAlign: "center",
            width: "60px",
            backgroundColor: row.is_shared === "Yes" ? "green" : "#DC3545",
          }}
        >
          {row.is_shared}
        </div>
      ),
    },
    {
      name: "Action",
      cell: (row) => (
        <>
          {row.is_shared === "Yes" && (
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                onClick={() => handleDeleteShared(row.bs_id)}
                className="dataedit_btn text-danger border-0 fs-5"
                title="Remove Share"
                aria-label="Remove Share"
              >
                <FaTrashAlt />
              </button>
            </div>
          )}
        </>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const filteredRecords = allcompany.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );
  const handlesharedLink = async () => {
    if (selectedIds.length > 0) {
      var module_id = allcompany[0].module_id;
      const moduleName =
        allmodule.find((m) => m.id === module_id)?.name || "Not Found";
      let formData = {
        company_id: selectedIds,
        datetime: form.meeting_date,
        session_id: id,
        module_name: moduleName,
        session_link: form.meetingLink,
        meeting_topic: form.topic,
      };
      try {
        const res = await axios.post(apiUrl + "sharedSessionLink", formData, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        });
        const checkmsg = res.data;

        if (checkmsg.status === 2) {
          console.log(checkmsg);
          seterrorMessageShare(checkmsg.message);
        } else {
          getallcompanises();
          setsuccessMessageShare(checkmsg.message);
          setSelectedIds([]);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };
  const handleClose = () => {
    setShow(false);
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: Deleteid,
    };
    try {
      const res = await axios.post(apiUrl + "deleteSessionLink", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setsuccessMessageShare("Session shared link deleted successfully");

      setShow(false);
      setTimeout(() => {
        getallcompanises();
        setsuccessMessageShare("");
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
  return (
    <>
      <div className="d-flex align-items-start gap-0">
        <Sidebar />
        <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
          <TopBar />
          <section className="dashboard_adminh">
            <div className="container-xl">
              <div className="row gy-4">
                <div className="col-12">
                  {successMessage && (
                    <SuccessAlert
                      message={successMessage}
                      onClose={() => setsuccessMessage("")}
                    />
                  )}
                  {errorMessage && (
                    <DangerAlert
                      message={errorMessage}
                      onClose={() => seterrorMessage("")}
                    />
                  )}
                  <div className="card p-4">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <Link
                        to="/admin/setting/broadcastsession"
                        className="btn btn-secondary"
                      >
                        <FaArrowLeft /> Back
                      </Link>
                      <h5 className="mb-0">
                        {id !== undefined ? "Edit Session" : "Create Session"}
                      </h5>
                    </div>

                    <form
                      onSubmit={handleSubmit}
                      className="d-flex flex-column gap-3"
                    >
                      <input type="hidden" name="id" value={editdata.id} />
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Session Topic{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="text"
                          name="topic"
                          className="form-control"
                          value={form.topic}
                          onChange={(e) =>
                            setForm({ ...form, topic: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Module{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <select
                          className="form-select"
                          name="module_id"
                          value={form.module_id}
                          onChange={(e) =>
                            setForm({ ...form, module_id: e.target.value })
                          }
                          required
                        >
                          <option value="">Select Module</option>
                          {allmodule.map((m, idx) => (
                            <option key={idx} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Session Date & Time{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="datetime-local"
                          name="meeting_date"
                          className="form-control"
                          value={form.meeting_date}
                          onChange={(e) =>
                            setForm({ ...form, meeting_date: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Session{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <select
                          className="form-select"
                          value={form.session}
                          name="session"
                          onChange={(e) =>
                            setForm({ ...form, session: e.target.value })
                          }
                          required
                        >
                          <option value="">Select Session</option>
                          <option value="morning">Morning Session</option>
                          <option value="afternoon">Afternoon Session</option>
                        </select>
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>Timezone</label>
                        <select
                          className="form-select"
                          value={form.timezone}
                          name="timezone"
                          onChange={(e) =>
                            setForm({ ...form, timezone: e.target.value })
                          }
                          required
                        >
                          {Intl.supportedValuesOf("timeZone").map((tz, idx) => (
                            <option key={idx} value={tz}>
                              {tz}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Meeting Link{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="url"
                          className="form-control"
                          value={form.meetingLink}
                          name="meetingLink"
                          onChange={(e) =>
                            setForm({ ...form, meetingLink: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Session Confirmed{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <select
                          className="form-select"
                          value={form.status}
                          name="status"
                          onChange={(e) =>
                            setForm({ ...form, status: e.target.value })
                          }
                          required
                        >
                          <option value="">Select</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      </div>
                      <div className="d-flex justify-content-end align-items-end gap-2">
                        <button type="submit" className="admin_btn mt-1">
                          {id !== undefined ? "Edit Schedule" : "Save Schedule"}
                        </button>
                      </div>
                    </form>
                  </div>
                  {id && form.status === "Yes" && (
                    <div className="card p-4 mt-2">
                      {errorMessageShare && (
                        <DangerAlert
                          message={errorMessageShare}
                          onClose={() => seterrorMessageShare("")}
                        />
                      )}
                      {successMessageShare && (
                        <SuccessAlert
                          message={successMessageShare}
                          onClose={() => setsuccessMessageShare("")}
                        />
                      )}
                      <div className="d-flex justify-content-between mb-3">
                        <h5 className="mb-3">All Companies</h5>
                        <Link
                          disabled={selectedIds}
                          to="javascript:void(0)"
                          onClick={() => handlesharedLink()}
                          className={`btn btn-primary ${selectedIds.length === 0 ? "disabled-link" : ""
                            }`}
                          style={
                            selectedIds.length === 0
                              ? { opacity: 0.5, pointerEvents: "none" }
                              : {}
                          }
                        >
                          Share Session Link <FaShareAlt />
                        </Link>
                      </div>
                      <div className="d-flex justify-content-end align-items-end">
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
                      <DataTable
                        columns={columns}
                        data={filteredRecords}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        noDataComponent={
                          <div className="text-center">
                            <span>No results found</span>
                          </div>
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
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
    </>
  );
}

export default AdminBroadcastAdd;
