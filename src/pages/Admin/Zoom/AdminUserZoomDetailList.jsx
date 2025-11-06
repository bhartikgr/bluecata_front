import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import DataTable from "react-data-table-component";
import { useNavigate } from "react-router-dom";
import { FaPlus } from "react-icons/fa6";
import { FaEdit, FaTrashAlt, FaVideo, FaVideoSlash } from "react-icons/fa";
import { Link } from "react-router-dom";
import axios from "axios";
import { Modal, Button } from "react-bootstrap";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import moment from "moment-timezone";

function AdminUserZoomDetailList() {
  const navigate = useNavigate();
  const [selectedZone, setSelectedZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [Deleteid, setDeleteid] = useState("");
  const [successMessage, setsuccessMessage] = useState("");
  const [show, setShow] = useState(false);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  document.title = "Zoom Meeting List - Admin";
  useEffect(() => {
    getallUsersDetaillist();
  }, []);
  const getallUsersDetaillist = async () => {
    try {
      const res = await axios.post(
        apiUrl + "getallUsersDetaillist",
        { user_id: "" },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      const respo = res.data.results || [];

      const dataWithStatus = respo.map(
        (meeting) => enrichWithStatus(meeting, selectedZone) // 👈 Pass user zone
      );
      console.log(dataWithStatus);
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
      name: "Topic",
      selector: (row) => row.topic,
      sortable: true,
      className: "age",
    },
    {
      name: "Module Name",
      selector: (row) => row.module_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Link",
      selector: (row) => row.zoom_link,
      sortable: true,
      className: "age",
    },
    {
      name: "Meeting Id",
      selector: (row) => row.meeting_id,
      sortable: true,
      className: "age",
    },
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
      sortable: true,
      className: "age",
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
      name: "Time Zone",
      selector: (row) => row.timezone,
      sortable: true,
      className: "age",
    },
    {
      name: "Status",
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
        <div className="d-flex align-items-start gap-3">
          <Link
            to={`/admin/zoomeetlist/useregister/${row.id}`}
            className="dataedit_btn  border-0 fs-5"
            title="Register User Meet"
          >
            <FaVideo />
          </Link>
          <Link
            to={`/admin/editzoomeet/${row.id}`}
            className="dataedit_btn  border-0 fs-5"
            title="Edit Meet"
          >
            <FaEdit />
          </Link>

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
      minWidth: "150px",
    },
  ];
  const getMeetingStatus = (meetingDate, time, timezone) => {
    if (!meetingDate || !time || !timezone) return "unknown";
    console.log(meetingDate, time, timezone, "kk");
    const dateStr = new Date(meetingDate).toISOString().split("T")[0]; // 'YYYY-MM-DD'
    const datetimeStr = `${dateStr} ${time}`;

    const meetingTime = moment.tz(datetimeStr, "YYYY-MM-DD HH:mm", timezone);
    const now = moment().tz(timezone);
    const diff = meetingTime.diff(now, "minutes");

    if (diff < 0) return "expired";
    if (diff <= 60) return "ongoing";
    return "upcoming";
  };
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
        getallUsersDetaillist();
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
        width: "100%",
        boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
        border: "1px solid #00000036",
        borderRadius: "12px",
        overflow: "auto",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#ff3f45",
        fontWeight: "600",
        fontSize: "12px",
        color: "#fff",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        // ❌ Remove minWidth here — it breaks layout
      },
    },
    cells: {
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        // ❌ Don't force 100% width here
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
          <div>
            <Sidebar />
          </div>
          <div className="flex-grow-1 dashboard_padding">
            <div className="d-flex flex-column gap-0 w-100">
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
                          <h5 className="mb-3">Zoom Meeting List</h5>
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
                          <Link to="/admin/createzoomeet" className="admin_btn">
                            Add Meet <FaPlus />
                          </Link>
                        </div>
                        <div className="responsive-table-wrapper">
                          <DataTable
                            columns={columns}
                            data={filteredRecords}
                            pagination
                            highlightOnHover
                            striped
                            responsive={true}
                            customStyles={customStyles}
                            className="custom-scrollbar custome-icon "
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
                </div>
              </section>
            </div>
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

export default AdminUserZoomDetailList;
