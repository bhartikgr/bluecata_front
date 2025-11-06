import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import DataTable from "react-data-table-component";
import { useNavigate, useParams } from "react-router-dom";
import { FaPlus } from "react-icons/fa6";
import { FaArrowLeft, FaTrashAlt, FaVideo, FaVideoSlash } from "react-icons/fa";
import { Link } from "react-router-dom";
import axios from "axios";
import { Modal, Button } from "react-bootstrap";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import moment from "moment-timezone";

function AdminUserZoomMeetRegister() {
  const navigate = useNavigate();
  const [selectedZone, setSelectedZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [Deleteid, setDeleteid] = useState("");
  const [successMessage, setsuccessMessage] = useState("");
  const [show, setShow] = useState(false);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  const { id } = useParams();
  document.title = "Register Zoom Meeting List - Admin";
  useEffect(() => {
    getallUsersJoinedMeet();
  }, []);
  const getallUsersJoinedMeet = async () => {
    try {
      const res = await axios.post(
        apiUrl + "getallUsersJoinedMeet",
        { user_id: "", id: id },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      const respo = res.data.results || [];
      console.log(respo);
      const dataWithStatus = respo.map(
        (meeting) => enrichWithStatus(meeting, selectedZone) // 👈 Pass user zone
      );

      setRecords(dataWithStatus);
    } catch (err) {
      console.error("Error:", err);
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
    let status = "upcoming";

    if (now.isAfter(meetingEnd)) {
      status = "expired";
    } else if (now.isBetween(localMeetingTime, meetingEnd)) {
      status = "ongoing";
    }

    // ✅ Step 4: Return updated meeting object with local info
    return {
      ...meeting,
      status,
      local_meeting_date: localMeetingTime.format("YYYY-MM-DD"),
      local_meeting_time: localMeetingTime.format("HH:mm"),
    };
  };

  const columns = [
    {
      name: "Name",
      selector: (row) => row.user_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Email",
      selector: (row) => row.user_email,
      sortable: true,
      className: "age",
    },
    {
      name: "Ip Address",
      selector: (row) => row.ip_address,
      sortable: true,
      className: "age",
    },
    {
      name: "User TimeZone",
      selector: (row) => row.usertimezone,
      sortable: true,
      className: "age",
    },
    {
      name: "Register DateTime",
      selector: (row) => {
        const date = new Date(row.join_date);
        return date.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true, // optional: use 24hr format if false
        });
      },
      sortable: true,
      className: "age",
    },
    {
      name: "Meeting Status",
      cell: (row) => {
        let colorClass = "";
        let label = "";

        switch (row.status) {
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
            label = row.status;
        }

        return <span className={colorClass}>{label}</span>;
      },
      sortable: true,
      className: "age",
    },

    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex align-items-center gap-3">
          <button
            type="button"
            onClick={() => handledelete(row.id)}
            className="deleteedit_btn border-0 fs-5"
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
  const handleClose = () => {
    setShow(false);
  };
  const handleConfirmDelete = async () => {
    return;
    let formData = {
      id: Deleteid,
    };
    try {
      const res = await axios.post(apiUrl + "mettingDelete", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setsuccessMessage("The meeting has been deleted successfully.");

      setShow(false);
      setTimeout(() => {
        getallUsersJoinedMeet();
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
                      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                        <Link
                          to={`/admin/zoomeetlist`}
                          className="btn btn-secondary py-2 "
                          style={{ width: "fit-content" }}
                        >
                          <FaArrowLeft /> Back
                        </Link>
                        <div className="d-flex justify-content-between">
                          <h5 className="mb-0">Register User List (Module)</h5>
                        </div>
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
    </>
  );
}

export default AdminUserZoomMeetRegister;
