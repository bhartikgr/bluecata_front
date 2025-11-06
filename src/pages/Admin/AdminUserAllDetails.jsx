import React, { useState, useEffect } from "react";
import Sidebar from "../../components/Admin/Sidebar";
import TopBar from "../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import AdminCompanyTopbar from "../../components/Admin/company/AdminCompanyTopbar";
import {
  Eye,
  Share2,
  FileText,
  File,
  Building2,
  Users,
  User,
} from "lucide-react";
import { Modal, Button } from "antd";
import {
  FaEllipsisV,
  FaBuilding,
  FaProjectDiagram,
  FaArrowLeft,
} from "react-icons/fa";
import { FaDownload, FaEye } from "react-icons/fa"; // FontAwesome icons
import axios from "axios";
import { useNavigate, Link, useParams } from "react-router-dom";
function AdminUserAllDetails() {
  const { id } = useParams();
  document.title = "Company Detail - Admin";
  const apiUrlAll = "http://localhost:5000/api/admin/adminall/";
  const [istotalDocs, settotalDocs] = useState("");
  const [totalsignatory, settotalsignatory] = useState("");
  const [userData, setuserData] = useState("");
  const [CompanyName, setCompanyName] = useState("");
  const navigate = useNavigate();
  const [totalinvestor, settotalinvestor] = useState("");
  const [total_shared_reports, settotal_shared_reports] = useState("");
  useEffect(() => {
    totalDocs();
  }, []);

  const totalDocs = async () => {
    let formData = {
      company_id: id,
    };
    try {
      const res = await axios.post(apiUrlAll + "totalDocs", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      settotalDocs(respo.total_docs);
      settotalsignatory(respo.total_signatory);
      settotalinvestor(respo.total_investor);
      settotal_shared_reports(respo.total_shared_reports);
      setCompanyName(respo.company_name);
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

  //Investor Doc Latest Version
  const [records, setrecords] = useState([]);
  const [recordsPrev, setrecordsPrev] = useState([]);
  const [searchText, setSearchText] = useState("");
  function formatCurrentDate(input) {
    const date = new Date(input); // ✅ Convert input to Date

    if (isNaN(date)) return ""; // ⛔ Invalid date check

    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    const getOrdinal = (n) => {
      if (n >= 11 && n <= 13) return "th";
      switch (n % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    };

    return `${month} ${day}${getOrdinal(day)}, ${year}`;
  }
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");

  // Open modal with selected role
  const handleViewRole = (row) => {
    setSelectedRole(row.signature_role);
    setIsModalVisible(true);
  };

  // Close modal
  const handleCloseModal = () => {
    setIsModalVisible(false);
    setSelectedRole("");
  };
  const columns = [
    {
      name: "First Name",
      selector: (row) => row.first_name,
      sortable: true,
    },
    {
      name: "Last Name",
      selector: (row) => row.last_name,
      sortable: true,
    },
    {
      name: "Email",
      selector: (row) => row.signatory_email,
      sortable: true,
    },
    {
      name: "Phone",
      selector: (row) => row.signatory_phone,
      sortable: true,
    },
    {
      name: "Role",
      selector: (row) => row.signatory_role, // used for sorting/search
      sortable: true,
      cell: (row) => (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>{row.signatory_role}</span>
          <Button
            onClick={() => handleViewRole(row)}
            type="primary"
            icon={<FaEye />}
            size="small"
          >
            View
          </Button>
        </div>
      ),
    },

    {
      name: "Joined",
      selector: (row) => row.access_status,
      sortable: true,
      cell: (row) => {
        // Capitalize first letter
        const status = row.access_status
          ? row.access_status.charAt(0).toUpperCase() +
          row.access_status.slice(1)
          : "";

        // Determine color
        const color =
          row.access_status?.toLowerCase() === "pending"
            ? "red"
            : row.access_status?.toLowerCase() === "active"
              ? "green"
              : "black";

        return <span style={{ color }}>{status}</span>;
      },
    },
  ];

  const filteredData = records.filter((item) => {
    const search = searchText.toLowerCase();
    return (
      (item.document_name || "").toLowerCase().includes(search) ||
      formatCurrentDate(item.created_at).toLowerCase().includes(search) ||
      (item.download || "").toLowerCase().includes(search)
    );
  });
  useEffect(() => {
    getcompanySignatory();
  }, []);
  const getcompanySignatory = async () => {
    let formData = {
      company_id: id,
    };
    try {
      const res = await axios.post(
        apiUrlAll + "getcompanySignatory",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;

      setrecords(respo);
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

  const [recordsinvestor, setrecordsinvestor] = useState([]);
  const [recordsexport, setrecordsexport] = useState([]);
  const [viewInvestorDetail, setviewInvestorDetail] = useState(false);

  const filteredDatainvestor = recordsinvestor.filter((item) => {
    const search = searchText.toLowerCase();
    return (
      (item.document_name || "").toLowerCase().includes(search) ||
      formatCurrentDate(item.created_at).toLowerCase().includes(search) ||
      (item.download || "").toLowerCase().includes(search)
    );
  });

  //Export File

  const customStyles = {
    table: {
      style: {
        overflow: "visible",
        minWidth: "100%",
        boxShadow:
          "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
        borderRadius: "12px",
        border: "1px solid #e5e7eb",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#f9fafb",
        fontWeight: "600",
        fontSize: "13px",
        color: "#374151",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        padding: "16px 12px",
        borderBottom: "2px solid #e5e7eb",
      },
    },
    cells: {
      style: {
        padding: "14px 12px",
        fontSize: "14px",
        color: "#1f2937",
        backgroundColor: "#ffffff",
      },
    },
    rows: {
      style: {
        fontSize: "14px",
        fontWeight: "500",
        minHeight: "56px",
        transition: "background-color 0.15s ease",
        "&:not(:last-of-type)": {
          borderBottom: "1px solid #f3f4f6",
        },
        "&:hover": {
          backgroundColor: "#f9fafb",
          cursor: "pointer",
        },
      },
      stripedStyle: {
        backgroundColor: "#fafafa",
      },
    },
    pagination: {
      style: {
        backgroundColor: "#f9fafb",
        padding: "14px 16px",
        borderTop: "1px solid #e5e7eb",
        borderBottomLeftRadius: "12px",
        borderBottomRightRadius: "12px",
        fontSize: "14px",
        color: "#6b7280",
      },
      pageButtonsStyle: {
        borderRadius: "6px",
        height: "36px",
        width: "36px",
        padding: "8px",
        margin: "0 4px",
        cursor: "pointer",
        transition: "all 0.2s",
        backgroundColor: "transparent",
        fill: "#6b7280",
        "&:disabled": {
          cursor: "not-allowed",
          fill: "#d1d5db",
        },
        "&:hover:not(:disabled)": {
          backgroundColor: "#e5e7eb",
          fill: "#374151",
        },
      },
    },
  };
  //Investor
  const [openDropdown, setOpenDropdown] = useState(null);

  const toggleDropdown = (id) => {
    // If the clicked row is already open, close it; otherwise open it
    setOpenDropdown(openDropdown === id ? null : id);
  };
  const [InvestorDetail, setInvestorDetail] = useState([]);
  const apiUrlCompany = "http://localhost:5000/api/admin/company/";
  const columnsinvestor = [
    {
      name: "First Name",
      selector: (row) => row.first_name,
      sortable: true,
    },
    {
      name: "Last Name",
      selector: (row) => row.last_name,
      sortable: true,
    },
    {
      name: "Email",
      selector: (row) => row.email,
      sortable: true,
    },
    {
      name: "Phone",
      selector: (row) => row.phone,
      sortable: true,
    },
    {
      name: "Register",
      selector: (row) => row.is_register,
      sortable: true,
      cell: (row) => {
        const isRegistered =
          row.is_register === "Yes" || row.is_register === "yes";

        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "500",
                backgroundColor: isRegistered ? "#dcfce7" : "#fee2e2",
                color: isRegistered ? "#166534" : "#991b1b",
                border: `1px solid ${isRegistered ? "#bbf7d0" : "#fecaca"}`,
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: isRegistered ? "#22c55e" : "#ef4444",
                }}
              />
              {row.is_register}
            </span>
          </div>
        );
      },
    },
  ];
  const filteredInvestors = InvestorDetail.filter((row) => {
    const search = searchText.toLowerCase();

    return (
      (row.first_name || "").toLowerCase().includes(search) ||
      (row.last_name || "").toLowerCase().includes(search) ||
      (row.email || "").toLowerCase().includes(search) ||
      (row.phone || "").toLowerCase().includes(search) ||
      (row.is_register || "").toLowerCase().includes(search)
    );
  });

  useEffect(() => {
    getcompanyInvestor();
  }, []);
  const getcompanyInvestor = async () => {
    let formData = {
      company_id: id,
    };
    try {
      const res = await axios.post(
        apiUrlCompany + "getcompanyInvestor",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;
      setInvestorDetail(respo);
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
      <div>
        <div className="d-flex align-items-start gap-0">
          <Sidebar />
          <div className="d-flex flex-column gap-0 dashboard_padding w-100">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    <h2>{userData.company_name}</h2>
                  </div>

                  {/* Alternative: Company Name as a Card */}
                  <div className="col-12">
                    <div className="row gy-4">
                      {/* Company Name Card */}
                      <AdminCompanyTopbar id={id} />

                      {/* Stats Cards */}
                      <div className="col-md-4">
                        <div className="d-flex align-items-center gap-2 dashmain_box">
                          <div className="icon_img">
                            <Users />
                          </div>
                          <div className="d-flex flex-column gap-0">
                            <h4>Total Signatory</h4>
                            <p>{totalsignatory}</p>
                          </div>
                        </div>
                      </div>

                      <div className="col-md-4">
                        <div className="d-flex align-items-center gap-2 dashmain_box">
                          <div className="icon_img">
                            <File />
                          </div>
                          <div className="d-flex flex-column gap-0">
                            <h4>Total Docs</h4>
                            <p>{istotalDocs}</p>
                          </div>
                        </div>
                      </div>

                      <div className="col-md-4">
                        <div className="d-flex align-items-center gap-2 dashmain_box">
                          <div className="icon_img">
                            <FileText />
                          </div>
                          <div className="d-flex flex-column gap-0">
                            <h4>Total Investor</h4>
                            <p>{InvestorDetail.length}</p>
                          </div>
                        </div>
                      </div>

                      <div className="col-md-4">
                        <div className="d-flex align-items-center gap-2 dashmain_box">
                          <div className="icon_img">
                            <Share2 />
                          </div>
                          <div className="d-flex flex-column gap-0">
                            <h4>Shared Reports</h4>
                            <p>{total_shared_reports}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-12">
                    <div className="card p-3">
                      <h5 className="mb-3">All Signatory</h5>
                      <div className="d-flex  flex-column justify-content-between align-items-start tb-box">
                        <DataTable
                          columns={columns}
                          data={filteredData}
                          pagination
                          highlightOnHover
                          striped
                          responsive
                          customStyles={customStyles}
                          className="custom-scrollbar custome-icon datatb-report"
                          noDataComponent={
                            <div className="text-center py-2">
                              <span>No users found</span>
                            </div>
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="card p-3">
                      <h5 className="mb-3">Investors</h5>
                      <div className="d-flex  flex-column justify-content-between align-items-start tb-box">
                        <style>
                          {`
                        .datatb-report {
                          overflow: visible !important;
                        }
                      `}
                        </style>
                        <DataTable
                          columns={columnsinvestor}
                          data={filteredInvestors}
                          pagination
                          highlightOnHover
                          striped
                          responsive
                          customStyles={customStyles}
                          className="custom-scrollbar custome-icon datatb-report"
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
              </div>
            </section>
          </div>
        </div>
      </div>

      <Modal
        title="Signatory Role"
        visible={isModalVisible}
        onOk={handleCloseModal}
        onCancel={handleCloseModal}
        okText="Close"
      >
        <p>{selectedRole || "No role assigned"}</p>
      </Modal>
    </>
  );
}

export default AdminUserAllDetails;
