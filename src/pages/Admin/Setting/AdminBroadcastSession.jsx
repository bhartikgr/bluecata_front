import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Link } from "react-router-dom";
import DataTable from "react-data-table-component";
import { FaPlus } from "react-icons/fa6";
import { Modal, Button } from "react-bootstrap";
import { FaTrashAlt, FaEdit } from "react-icons/fa";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import CompanyShareReferal from "../../../components/Admin/popup/CompanyShareReferal";
import moment from "moment-timezone";
function AdminBroadcastSession() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  useEffect(() => {
    document.title = "Broadcast Session List - Admin";
  }, []);
  const [selectedZone, setSelectedZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [searchQuery, setSearchQuery] = useState("");
  const [CodeId, setCodeId] = useState("");
  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

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
      name: "Meeting Date",
      selector: (row) => {
        const date = new Date(row.meeting_date);
        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        });
      },
    },

    {
      name: "Time",
      selector: (row) => {
        if (!row.time) return "-";

        const [hour, minute] = row.time.split(":").map(Number);
        const date = new Date();
        date.setHours(hour);
        date.setMinutes(minute);

        return date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      },
      sortable: true,
      className: "age",
    },

    {
      name: "Session Type",
      selector: (row) => row.session,
      sortable: true,
      className: "age",
    },

    {
      name: "TimeZone",
      selector: (row) => row.timezone,
      sortable: true,
      className: "age",
    },
    {
      name: "Status",
      cell: (row) => {
        let colorClass = "";
        let label = "";

        switch (row.statusexp) {
          case "upcoming":
            colorClass = "badge bg-info";
            label = "Upcoming";
            break;
          case "ongoing":
            colorClass = "badge bg-success";
            label = "Ongoing";
            break;
          case "expired":
            colorClass = "badge bg-danger";
            label = "Expired";
            break;
          default:
            colorClass = "badge bg-secondary";
            label = row.statusexp;
        }

        return <span className={colorClass}>{label}</span>;
      },
      sortable: true,
      className: "age",
    },

    {
      name: "Action",
      cell: (row) => (
        <>
          <div className="d-flex align-items-center gap-2">
            <Link
              className="dataedit_btn fs-5"
              to={`/admin/setting/broadcast/editsession/${row.id}`}
              title="Edit"
            >
              <FaEdit />
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(row.id)}
              className=" deleteedit_btn text-white border-0 fs-5"
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

  useEffect(() => {
    getboradCasteList();
  }, []);
  const getboradCasteList = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getboradCasteList", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      const respo = res.data.results || [];

      const dataWithStatus = respo.map(
        (meeting) => enrichWithStatus(meeting, selectedZone) // 👈 Pass user zone
      );

      setRecords(dataWithStatus);
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
  const enrichWithStatus = (meeting, userZone) => {
    if (!meeting.meeting_date || !meeting.time) {
      return { ...meeting, status: "unknown" };
    }

    const meetingZone = meeting.timezone;

    // ✅ Step 1: Create full datetime in original meeting timezone
    const meetingDateTime = moment.tz(
      `${meeting.meeting_date} ${meeting.time}`,
      "YYYY-MM-DD HH:mm",
      meetingZone
    );

    // ✅ Step 2: Convert to user's local timezone
    const localMeetingTime = meetingDateTime.clone().tz(userZone);
    const now = moment.tz(userZone);

    // ✅ Step 3: Define status based on local comparison
    const meetingEnd = localMeetingTime.clone().add(30, "minutes");
    let statusexp = "upcoming";

    if (now.isAfter(meetingEnd)) {
      statusexp = "expired";
    } else if (now.isBetween(localMeetingTime, meetingEnd)) {
      statusexp = "ongoing";
    }

    // ✅ Step 4: Return updated meeting object with local info
    return {
      ...meeting,
      statusexp,
      local_meeting_date: localMeetingTime.format("YYYY-MM-DD"),
      local_meeting_time: localMeetingTime.format("HH:mm"),
    };
  };
  const handleClose = () => {
    setShow(false);
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: Deleteid,
    };
    try {
      const res = await axios.post(apiUrl + "deleteSessionmeet", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      setShow(false);
      getboradCasteList();
      setsuccessMessage("Session deleted successfully.");
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

  const returnrefresh = () => { };
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
                      <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap mb-4">
                        <h5 className="mb-0">Broadcast Session</h5>
                        <Link
                          to="/admin/setting/broadcast/addsession"
                          className="admin_btn"
                        >
                          Add Session <FaPlus />
                        </Link>
                      </div>
                      <div className="d-flex justify-content-end align-items-end mb-3">
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
        />
      )}
    </>
  );
}

export default AdminBroadcastSession;
