import React, { useState, useEffect } from "react";
import DataTable from "react-data-table-component";
import TopBar from "../../../components/Users/TopBar";
import ModuleSideNav from "../../../components/Users/ModuleSideNav.jsx";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../../components/Styles/MainHeadStyles.js";
import { DataRoomSection } from "../../../components/Styles/DataRoomStyle.js";
import axios from "axios";
import {
  FaEdit,
  FaDownload,
  FaLock,
  FaCheck,
  FaTrash,
  FaEye,
} from "react-icons/fa"; // FontAwesome icons
import DangerAlertPopup from "../../../components/Admin/DangerAlertPopup";
import { Button } from "../../../components/Styles/MainStyle.js";
import { loadStripe } from "@stripe/stripe-js";
import { Link, useNavigate } from "react-router-dom";
// import { fontWeight } from "html2canvas/dist/types/css/property-descriptors/font-weight.js";
const stripePromise = loadStripe(
  "pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"
);
export default function InvestorEntry() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState("");
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [records, setrecords] = useState([]);
  const [Deleteid, setDeleteid] = useState("");
  const [messagesuccessError, setmessagesuccessError] = useState("");
  const [dangerMessagealertDoc, setdangerMessagealertDoc] = useState("");
  const [errr, seterrr] = useState(false);
  const [authorizedData, setAuthorizedData] = useState(null);
  var apiURL = "http://localhost:5000/api/user/investor/";
  const apiURLSignature = "http://localhost:5000/api/user/";
  document.title = "Add Investor";
  const customStyles = {
    table: {
      style: {
        border: "1px solid #dee2e6",
        borderRadius: "12px",
        overflow: "auto",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#efefef",
        fontWeight: "600",
        fontSize: "0.8rem",
        color: "#000",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      },
    },
    cells: {
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
    },
    rows: {
      style: {
        fontSize: "0.8rem",
        fontWeight: "500",
      },
      stripedStyle: {
        backgroundColor: "#fff",
      },
    },
    pagination: {
      style: {
        marginTop: "15px",
        backgroundColor: "#fafafa",
        padding: "12px 16px",
      },
    },
  };
  const conditionalRowStyles = [
    {
      when: (row) => true, // apply to all rows
      style: {
        "&:hover": {
          backgroundColor: "var(--lightRed)", // apna hover color
        },
      },
    },
  ];
  useEffect(() => {
    getAuthorizedSignature();
  }, []);
  const getAuthorizedSignature = async () => {
    let formData = {
      company_id: userLogin.companies[0].id,
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURLSignature + "getAuthorizedSignature",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      const checkData = res.data.results;
      if (checkData.length > 0) {
        setAuthorizedData(checkData[0]);
      }
    } catch (err) { }
  };
  useEffect(() => {
    getInvestorlist();
  }, []);
  const getInvestorlist = async () => {
    const formData = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const generateRes = await axios.post(
        apiURL + "getInvestorlist",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setrecords(generateRes.data.results);
    } catch (err) {
      console.error("Error generating summary", err);
    }
    //  Optionally, call AI Summary API here
  };
  const [Deleteidcompany_investor, setDeleteidcompany_investor] = useState("");
  const handleDelete = (companyinvestorid, id) => {
    setDeleteid(id);
    setDeleteidcompany_investor(companyinvestorid);
    setdangerMessagealertDoc(
      "Are you sure you want to delete this investor? All shared reports will also be deleted"
    );
  };
  const columns = [
    {
      // name: 'Date of Report',
      name: "Email",
      selector: (row) => row.email,
      sortable: true,
    },

    {
      // name: 'Date of Report',
      name: "First Name",
      selector: (row) => row.first_name,
      sortable: true,
    },
    {
      // name: 'Date of Report',
      name: "Last Name",
      selector: (row) => row.first_name,
      sortable: true,
    },
    {
      name: "Platform Register",
      selector: (row) => row.is_register,
      sortable: true,
      cell: (row) => {
        const isActive = row.is_register?.toLowerCase() === "yes"; // true if Yes, false if No

        return (
          <span
            style={{
              padding: "4px 12px",
              borderRadius: "12px",
              fontWeight: 600,
              color: isActive ? "#065f46" : "#b91c1c", // green if Yes, red if No
              backgroundColor: isActive ? "#d1fae5" : "#fee2e2", // green bg if Yes, red bg if No
              fontSize: "12px",
              display: "inline-block",
            }}
          >
            {isActive ? "Yes" : "No"} {/* Display correct text */}
          </span>
        );
      },
    },
    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex gap-2">
          <Link
            to={`/crm/investor/investor-info/${row.id}`}
            rel="noopener noreferrer"
            className="icon_btn green_clr"
            title="Edit"
          >
            <FaEye /> View Detail
          </Link>
          <button
            type="button"
            onClick={() => handleDelete(row.company_investor_id, row.id)}
            rel="noopener noreferrer"
            className="icon_btn red_clr"
            title="Delete"
          >
            <FaTrash /> Delete
          </button>
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
      width: "220px",
    },
  ];
  const filteredData = records.filter((item) => {
    const name = `${item.investorType || ""} - ${item.investmentPreference || ""
      } - ${item.version || ""}`;
    return (
      name.toLowerCase().includes(searchText.toLowerCase()) ||
      (item.update_date || "")
        .toLowerCase()
        .includes(searchText.toLowerCase()) ||
      (item.download || "").toLowerCase().includes(searchText.toLowerCase())
    );
  });
  const handlenewinvestor = () => {
    // Owner bypass
    if (userLogin.role === "owner") {
      navigate("/crm/addnew-investor");
      return;
    }

    if (authorizedData !== null) {
      if (authorizedData.approve === "No") {
        seterrr(true);
        setmessagesuccessError("Please verify your signature");
        setTimeout(() => {
          seterrr(false);
          navigate("/authorized-signature");
        }, 1500);
      } else {
        navigate("/crm/addnew-investor");
      }
    } else {
      seterrr(true);
      setmessagesuccessError("Please verify your signature");
      setTimeout(() => {
        seterrr(false);
        navigate("/authorized-signature");
      }, 1500);
    }
  };

  const handleConfirm = async () => {
    const formData = {
      company_id: userLogin.companies[0].id,
      id: Deleteid,
      company_investor_id: Deleteidcompany_investor,
    };

    try {
      const generateRes = await axios.post(
        apiURL + "deleteinvestor",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setdangerMessagealertDoc("");
      setmessagesuccessError("Deleted succcessfully");
      getInvestorlist();
      setTimeout(() => {
        setmessagesuccessError("");
      }, 2500);
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const [isCollapsed, setIsCollapsed] = useState(false);
  return (
    <>
      <>
        <Wrapper>
          <div className="fullpage d-block">
            <div className="d-flex align-items-start gap-0">
              <ModuleSideNav
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
              />
              <div
                className={`global_view ${isCollapsed ? "global_view_col" : ""
                  }`}
              >
                <TopBar />
                <SectionWrapper className="d-block p-md-4 p-3">
                  <div className="container-fluid">
                    {dangerMessagealertDoc && (
                      <DangerAlertPopup
                        message={dangerMessagealertDoc}
                        onConfirm={handleConfirm}
                        onCancel={() => {
                          setdangerMessagealertDoc("");
                        }}
                      />
                    )}
                    {messagesuccessError && (
                      <p
                        className={
                          errr ? " mt-3 error_pop" : "success_pop mt-3"
                        }
                      >
                        {messagesuccessError}
                      </p>
                    )}
                    <DataRoomSection className="d-flex flex-column gap-2">
                      <div className="titleroom d-flex justify-content-between align-items-center border-bottom pb-3">
                        <div className="pb-3 bar_design">
                          <h4 className="h5 mb-0">Investor Entry</h4>
                        </div>
                        <Link
                          to="javascript:void(0)"
                          onClick={handlenewinvestor}
                          className="btn btn-outline-dark active"
                          style={{
                            opacity:
                              userLogin.role === "owner" ||
                                authorizedData?.approve === "Yes"
                                ? 1
                                : 0.6,
                            pointerEvents:
                              userLogin.role === "owner" ||
                                authorizedData?.approve === "Yes"
                                ? "auto"
                                : "none", // disables click if not approved and not owner
                          }}
                        >
                          Add New Investor
                        </Link>
                      </div>
                      <div className="d-flex justify-content-end my-2 p-0">
                        <input
                          type="search"
                          placeholder="Search Here..."
                          className="form-control"
                          value={searchText} // link input to state
                          onChange={(e) => setSearchText(e.target.value)}
                          style={{
                            padding: "10px 15px",
                            width: "100%",
                            maxWidth: "300px",
                            fontSize: "14px",
                            borderRadius: "10px",
                          }}
                        />
                      </div>
                      <div className="d-flex flex-column justify-content-between align-items-start tb-box">
                        <DataTable
                          customStyles={customStyles}
                          conditionalRowStyles={conditionalRowStyles}
                          columns={columns}
                          className="datatb-report"
                          data={filteredData}
                          pagination
                          highlightOnHover
                          striped
                          responsive
                        />
                      </div>
                    </DataRoomSection>
                  </div>
                </SectionWrapper>
              </div>
            </div>
          </div>
        </Wrapper>
      </>
    </>
  );
}
