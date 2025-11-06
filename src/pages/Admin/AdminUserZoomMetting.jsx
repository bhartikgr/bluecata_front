import React, { useState, useEffect } from "react";
import Sidebar from "../../components/Admin/Sidebar";
import TopBar from "../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { useNavigate, useParams } from "react-router-dom";
import { FaPlus } from "react-icons/fa6";
import { Link } from "react-router-dom";
import axios from "axios";
import { FaTrashAlt } from "react-icons/fa";
function AdminUserZoomMetting() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [deleteId, setdeleteId] = useState(false);
  const [showEdit, setshowEdit] = useState(false);
  const [editdata, seteditdata] = useState("");
  const [spinners, setspinnsers] = useState(false);
  const { id } = useParams();
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  document.title = "User Zoom Metting - Admin";
  useEffect(() => {
    getallUserList();
  }, [id]);
  const getallUserList = async () => {
    let formData = {
      user_id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getallUserList", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      if (respo.length === 0) {
        navigate("/admin/userzoomdetail");
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
  useEffect(() => {
    getallUsersMeetinglist();
  }, [id]);
  const getallUsersMeetinglist = async () => {
    let formData = {
      user_id: id,
    };
    try {
      const res = await axios.post(
        apiUrl + "getallUsersMeetinglist",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
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
      name: "No.",
      cell: (row, index) => index + 1,
      width: "60px",
      sortable: false,
    },

    {
      name: "Module Name",
      selector: (row) => row.module_name,

      sortable: true,
      className: "age",
    },
    {
      name: "Meeting Date",
      selector: (row) => new Date(row.meeting_date).toLocaleDateString("en-CA"),
      sortable: true,
      className: "age",
    },
    {
      name: "Time",
      selector: (row) => row.time,
      sortable: true,
      className: "age",
    },
    {
      name: "Metting Url",
      selector: (row) => row.zoom_link,
      sortable: true,
      cell: (row) => (
        <a
          className="btn btn-success text-white"
          target="_blank"
          href={row.zoom_link}
        >
          View Link
        </a>
      ),
    },
    {
      name: "Status",
      selector: (row) => row.token_expiry, // you can keep it or remove if unused
      sortable: true,
      className: "status",
      cell: (row) => {
        const now = new Date();
        const meetingDate = new Date(row.meeting_date);
        const tokenExpiry = new Date(row.token_expiry);
        if (now > tokenExpiry)
          return <span className="btn btn-danger text-white">Expired</span>;
        if (now > meetingDate)
          return <span className="btn btn-success text-white">Active</span>;
      },
    },
    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex align-items-center gap-3">
          <button
            type="button"
            onClick={() => handledelete(row.id)}
            className="dataedit_btn text-danger border-0 fs-5"
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
                      <div className="d-flex justify-content-between mb-3">
                        <h5 className="mb-3">
                          Meeting List (
                          {records.length > 0 && (
                            <strong>{records[0].email}</strong>
                          )}
                          )
                        </h5>
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
                        noDataComponent="No results found."
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

export default AdminUserZoomMetting;
