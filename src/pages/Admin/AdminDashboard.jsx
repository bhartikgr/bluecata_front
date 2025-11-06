import React, { useState, useEffect } from "react";
import Sidebar from "../../components/Admin/Sidebar";
import TopBar from "../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import {
  Building2,
  UserCheck,
  Component,
  Presentation,
  BookText,
  ShieldOff,
} from "lucide-react";
import axios from "axios";
import moment from "moment-timezone";
function AdminDashboard() {
  const [search, setSearch] = useState("");
  const [users, setrecord] = useState([]);
  const [totalActiveMeeting, settotalActiveMeeting] = useState("0");
  const [totalExpMeeting, settotalExpMeeting] = useState("0");
  const filteredUsers = users.filter((user) => {
    const firstName = user?.first_name?.toLowerCase() || "";
    const lastName = user?.last_name?.toLowerCase() || "";
    const email = user?.email?.toLowerCase() || "";
    const searchTerm = search?.toLowerCase() || "";

    return (
      firstName.includes(searchTerm) ||
      lastName.includes(searchTerm) ||
      email.includes(searchTerm)
    );
  });

  const columns = [
    {
      name: "Company Name",
      selector: (row) => row.company_name,
      sortable: true,
      className: "age",
    },

    {
      name: "Phone Number",
      selector: (row) => row.phone,
      sortable: true,
      className: "age",
    },
    {
      name: "Number of Employees",
      selector: (row) => row.employee_number,
      sortable: true,
      className: "age",
    },
    {
      name: "Company Website",
      selector: (row) => row.company_website,
      sortable: true,
      className: "age",
    },
  ];
  const [totalCompany, settotalCompany] = useState([]);
  const [totalModule, settotalModule] = useState([]);
  const [selectedZone, setSelectedZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [TotalCountUser, setTotalCountUser] = useState([]);
  document.title = "Admin Dashbord Page";
  const apiUrl = "http://localhost:5000/api/admin/dashboard/";
  useEffect(() => {
    getTotalUsers();
  }, []);
  const getTotalUsers = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(
        apiUrl + "getTotalUsersDashboard",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;
      setrecord(respo);
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
  useEffect(() => {
    getTotalUsersCompanies();
  }, []);
  const getTotalUsersCompanies = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(
        apiUrl + "getTotalUsersCompanies",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );

      var respo = res.data.results;
      setTotalCountUser(respo);
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
  useEffect(() => {
    getTotalCompany();
  }, []);
  const getTotalCompany = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getTotalCompany", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      settotalCompany(respo);
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
  useEffect(() => {
    getTotalmodule();
    getTotalactivemeeting();
  }, []);
  const getTotalmodule = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getTotalmodule", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      settotalModule(respo);
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
  const getTotalactivemeeting = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getTotalactivemeeting", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      const dataWithStatus = respo.map(
        (meeting) => enrichWithStatus(meeting, selectedZone) // 👈 Pass user zone
      );
      const upcomingCount = dataWithStatus.filter(
        (m) => m.status === "upcoming"
      ).length;
      const ongoingCount = dataWithStatus.filter(
        (m) => m.status === "ongoing"
      ).length;
      const expiredCount = dataWithStatus.filter(
        (m) => m.status === "expired"
      ).length;
      var totalactive = upcomingCount + ongoingCount;
      settotalActiveMeeting(totalactive);
      settotalExpMeeting(expiredCount);
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
    <div>
      <div className="d-flex align-items-start gap-0">
        <Sidebar />
        <div className="d-flex flex-column gap-0 dashboard_padding w-100">
          <TopBar />
          <section className="dashboard_adminh">
            <div className="container-xl">
              <div className="row gy-4">
                <div className="col-12">
                  <h2>Dashboard</h2>
                </div>
                <div className="col-12">
                  <div className="row gy-4">
                    <div className="col-md-4">
                      <div className="d-flex align-items-center gap-2 dashmain_box">
                        <div className="icon_img">
                          <UserCheck />
                        </div>
                        <div className="d-flex flex-column gap-0">
                          <h4>Total Users</h4>
                          <p>{TotalCountUser.length}</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="d-flex align-items-center gap-2 dashmain_box">
                        <div className="icon_img">
                          <Building2 />
                        </div>
                        <div className="d-flex flex-column gap-0">
                          <h4>Total Company</h4>
                          <p> {totalCompany.length}</p>
                        </div>
                      </div>
                    </div>
                    {/* <div className="col-md-4">
                      <div className="d-flex align-items-center gap-2 dashmain_box">
                        <div className="icon_img">
                          <UserCheck />
                        </div>
                        <div className="d-flex flex-column gap-0">
                          <h4>Subscriptions</h4>
                          <p>0</p>
                        </div>
                      </div>
                    </div> */}
                    <div className="col-md-4">
                      <div className="d-flex align-items-center gap-2 dashmain_box">
                        <div className="icon_img">
                          <Component />
                        </div>
                        <div className="d-flex flex-column gap-0">
                          <h4>Total Module</h4>
                          <p>{totalModule.length}</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="d-flex align-items-center gap-2 dashmain_box">
                        <div className="icon_img">
                          <Presentation />
                        </div>
                        <div className="d-flex flex-column gap-0">
                          <h4>Active Meeting</h4>
                          <p>{totalActiveMeeting}</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="d-flex align-items-center gap-2 dashmain_box">
                        <div className="icon_img">
                          <ShieldOff />
                        </div>
                        <div className="d-flex flex-column gap-0">
                          <h4>Expired Meeting</h4>
                          <p>{totalExpMeeting}</p>
                        </div>
                      </div>
                    </div>

                    <div className="col-md-4">
                      <div className="d-flex align-items-center gap-2 dashmain_box">
                        <div className="icon_img">
                          <BookText />
                        </div>
                        <div className="d-flex flex-column gap-0">
                          <h4>Total Docs</h4>
                          <p>1</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-12">
                  <div className="card p-3">
                    <h5 className="mb-3">Latest Companies</h5>
                    <div className="d-flex justify-content-end align-items-end"></div>
                    <DataTable
                      columns={columns}
                      data={filteredUsers}
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
  );
}

export default AdminDashboard;
