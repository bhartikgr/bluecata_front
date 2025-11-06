import React, { useState, useEffect } from "react";
import {
  Overlay,
  ModalContainer,
  ModalTitle,
  CloseButton,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";
import axios from "axios";
import { Button } from "bootstrap";
import DataTable from "react-data-table-component";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import DangerAlert from "../../../components/Admin/DangerAlert";
const CompanyShareReferal = ({ onClose, codeid, returnrefresh, RowId }) => {
  var apiURLINFile = "http://localhost:5000/api/admin/module/";
  const [emails, setEmails] = useState([""]);
  const [searchQuery, setSearchQuery] = useState("");
  const [spinners, setspinners] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState([]);
  const [err, seterr] = useState(false);
  const [successresponse, setsuccessresponse] = useState("");
  const [records, setRecords] = useState([]);
  useEffect(() => {
    getallcompanises();
  }, []);
  const getallcompanises = async () => {
    let formData = {
      codeid: codeid,
    };
    try {
      const res = await axios.post(
        apiURLINFile + "getallcompanisesForShareCode",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data;
      setRecords(respo.results);
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
    const allEmails = [
      ...selectedEmails, // objects {id, email}
      ...emails
        .filter((e) => e.trim() !== "")
        .map((email) => ({ id: null, email: email.trim().toLowerCase() })), // id null for manually typed
    ];

    e.preventDefault();
    let payload = {
      shared_by: "Admin",
      discount_code: codeid,
      emails: allEmails,
      RowId: RowId,
    };

    if (allEmails.length === 0) {
      setsuccessresponse("Please provide at least one email.");
      seterr(true);
      setTimeout(() => {
        seterr(false);
        setsuccessresponse("");
      }, 2000);
      return;
    }

    // Check for duplicate emails
    const emailSet = new Set(allEmails.map((e) => e.email));
    console.log(allEmails);
    // if (emailSet.size !== allEmails.length) {
    //   seterr(true);
    //   setsuccessresponse("Duplicate emails are not allowed.");
    //   setTimeout(() => {
    //     seterr(false);
    //     setsuccessresponse("");
    //   }, 2000);
    //   return;
    // }

    setspinners(true);
    try {
      const res = await axios.post(apiURLINFile + "shareCodeCompany", payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setspinners(false);
      setsuccessresponse(res.data.message);
      if (res.data.status === "2") {
        seterr(true);
      }
      if (res.data.status === "1") {
        getallcompanises();
        setSelectedEmails([]);
        seterr(false);
        setTimeout(() => {
          returnrefresh();
        }, 2000);
      }

      setTimeout(() => {
        setsuccessresponse("");
      }, 2000);
    } catch (err) {
      console.error("Submit error:", err);
    }
  };
  const handleAddMoreEmail = () => {
    setEmails([...emails, ""]);
  };

  // Handle input changes
  const handleEmailChange = (index, value) => {
    const updated = [...emails];
    updated[index] = value;
    setEmails(updated);
  };

  // Optional: remove email input field
  const handleRemoveEmail = (index) => {
    const updated = emails.filter((_, i) => i !== index);
    setEmails(updated);
  };

  //get Company
  const filteredRecords = records.filter((record) => {
    const search = searchQuery.toLowerCase();
    return (
      record.company_email?.toLowerCase().includes(search) ||
      record.company_name?.toLowerCase().includes(search) ||
      record.company_country?.toLowerCase().includes(search)
    );
  });

  const columns = [
    {
      name: "",
      cell: (row) => {
        const isEmailEmpty =
          !row.company_email || row.company_email.toString().trim() === "";

        return (
          <input
            type="checkbox"
            checked={selectedEmails.some((e) => e.id === row.id)}
            // disabled={isEmailEmpty}  // ❌ removed
            title={isEmailEmpty ? "No email available" : "Select"}
            onChange={(e) => {
              handleCheckboxChange(
                { id: row.id, email: row.company_email },
                e.target.checked
              );
            }}
          />
        );
      },
      width: "60px",
    },
    {
      name: "Company Email",
      selector: (row) => row.company_email,
      sortable: true,
      className: "age",
    },
    {
      name: "Company Name",
      selector: (row) => row.company_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Country",
      selector: (row) => row.company_country,
      sortable: true,
      className: "age",
    },
  ];
  const handleCheckboxChange = (company, checked) => {
    // company = { id: row.id, email: row.company_email }
    if (checked) {
      setSelectedEmails((prev) => [...prev, company]);
    } else {
      setSelectedEmails((prev) => prev.filter((e) => e.id !== company.id));
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
    <Overlay>
      <ModalContainer
        className="px-3 dashboard_adminh"
        style={{
          maxWidth: "900px",
          maxHeight: "550px",
          overflowY: "scroll",
          overflowX: "hidden",
        }}
      >
        <form
          onSubmit={handleSubmit}
          method="post"
          action="javascript:void(0)"
          style={{ height: "100%", display: "flex", flexDirection: "column" }}
        >
          <CloseButton onClick={onClose}>×</CloseButton>

          {successresponse &&
            (err ? (
              <DangerAlert
                message={successresponse}
                onClose={() => setsuccessresponse("")}
              />
            ) : (
              <SuccessAlert
                message={successresponse}
                onClose={() => setsuccessresponse("")}
              />
            ))}

          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
            <ModalTitle className="aititle" style={{ fontSize: "25px" }}>
              Share Code ({codeid}) to Companies
            </ModalTitle>
            {/* 🔍 Search Bar */}
            <div className="search-bar position-relative">
              <input
                type="text"
                className="form-control"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="search-icon position-absolute end-0 me-3 top-50 translate-middle-y">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  width="20"
                  height="20"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                  />
                </svg>
              </span>
            </div>
          </div>

          {/* 📋 Data Table */}
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

          {/* 📧 Email Inputs */}
          {/* <div className="formmodalShared">
            <label className="mb-2">Email</label>
            {emails.map((email, index) => (
              <div key={index} className="form-group mb-2 d-flex gap-2">
                <input
                  type="email"
                  className="form-control"
                  placeholder="Enter email..."
                  value={email}
                  onChange={(e) => handleEmailChange(index, e.target.value)}
                />
                {index > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleRemoveEmail(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div> */}

          {/* ➕ Add / Submit Buttons */}
          <div className="form-group pt-2">
            <div className="d-flex justify-content-end align-items-center flex-wrap">
              {/* <button
                type="button"
                className="btn btn-outline-dark active addbtn"
                onClick={handleAddMoreEmail}
              >
                + Add More Email
              </button> */}

              <ButtonGroup className="d-flex gap-2">
                <ModalBtn
                  onClick={onClose}
                  className="global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                >
                  Close
                </ModalBtn>
                <ModalBtn
                  disabled={spinners}
                  variant="upload"
                  type="submit"
                  style={{ opacity: spinners ? 0.6 : 1 }}
                  className="admin_btn d-flex align-items-center gap-2"
                >
                  Share
                  {spinners && (
                    <div
                      className="white-spinner spinner-border spinneronetimepay m-0"
                      role="status"
                    >
                      <span className="visually-hidden"></span>
                    </div>
                  )}
                </ModalBtn>
              </ButtonGroup>
            </div>
          </div>
        </form>
      </ModalContainer>
    </Overlay>
  );
};

export default CompanyShareReferal;
