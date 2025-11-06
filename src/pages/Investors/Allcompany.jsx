import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import DataTable from "react-data-table-component";
import MainHeaderInvestor from "../../components/Investor/MainHeaderInvestor.js";
import ModuleSideNav from "../../components/Investor/ModuleSideNav";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import { DataRoomSection } from "../../components/Styles/DataRoomStyle.js";
import { FaDownload } from "react-icons/fa"; // FontAwesome icons
import axios from "axios";
export default function Allcompany() {
  const navigate = useNavigate();
  const [records, setrecords] = useState([]);
  var apiURLINFile = "http://localhost:5000/api/user/investorreport/";
  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);

  useEffect(() => {
    getInvestorReport();
  }, []);
  const getInvestorReport = async () => {
    const formData = {
      email: userLogin.email,
    };
    try {
      const res = await axios.post(
        apiURLINFile + "getreportForInvestorCompany",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setrecords(res.data.results);
    } catch (err) {
      console.error("Error generating summary", err);
    }
    //  Optionally, call AI Summary API here
  };
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
  const columns = [
    {
      name: "Company Name",
      selector: (row) => row.company_name,
      sortable: true,
    },
    {
      name: "Company Email",
      selector: (row) => row.email,
      sortable: true,
    },

    {
      name: "Country",
      selector: (row) => row.company_country,
      sortable: true,
    },
    {
      name: "Role",
      selector: (row) => row.role,
      sortable: true,
    },
  ];
  const handleDownload = async (url, id) => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiURLINFile + "viewReport", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      window.open(url, "_blank");
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };

  const customStyles = {
    headCells: {
      style: {
        fontSize: "14px",
      },
    },
  };

  const [searchText, setSearchText] = useState("");

  // Filter data by nameofreport (case insensitive)
  const filteredData = records.filter((item) => {
    const search = searchText.toLowerCase();
    return (
      (item.document_name || "").toLowerCase().includes(search) ||
      formatCurrentDate(item.created_at).toLowerCase().includes(search) ||
      (item.download || "").toLowerCase().includes(search)
    );
  });
  //handle Share Report
  const [isCollapsed, setIsCollapsed] = useState(false);
  //handle Share Report
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <MainHeaderInvestor />
          <SectionWrapper className="d-block py-5">
            <div className="container-fluid">
              <div className="row">
                <div className="col-md-3">
                  <ModuleSideNav
                    isCollapsed={isCollapsed}
                    setIsCollapsed={setIsCollapsed}
                  />
                </div>
                <div className="col-md-9">
                  <DataRoomSection className="d-flex flex-column gap-2">
                    <div className="titleroom d-flex justify-content-between align-items-center border-bottom pb-3">
                      <h4>Report List</h4>
                    </div>
                    <div className="d-flex flex-column justify-content-between align-items-start">
                      <DataTable
                        customStyles={customStyles}
                        columns={columns}
                        data={filteredData}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                      />
                    </div>
                  </DataRoomSection>
                </div>
              </div>
            </div>
          </SectionWrapper>
        </div>
      </Wrapper>
    </>
  );
}
