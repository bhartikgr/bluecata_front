import React, { useState, useEffect } from "react";

import { IoCloseCircleOutline } from "react-icons/io5";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import TopBar from "../../components/Users/TopBar";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import {
  DataRoomSection,
  Title,
  TableHeader,
  TableData,
  UploadButton,
} from "../../components/Styles/DataRoomStyle.js";

import "react-big-calendar/lib/css/react-big-calendar.css";
import axios from "axios";
import UploadModal from "../../components/Users/popup/UploadModal.jsx";
import UploadModalUpdate from "../../components/Users/popup/UploadModalUpdate.jsx";
import AiSummaryForm from "../../components/Users/popup/AiSummaryForm.jsx";
import AiQuestionForm from "../../components/Users/popup/AiQuestionForm.jsx";
import DangerAlertPopup from "../../components/Admin/DangerAlertPopup";
import DangerAlertPopupMessage from "../../components/Admin/DangerAlertPopupMessage";
import { FaTimes } from "react-icons/fa";
import { useParams, useNavigate } from "react-router-dom";

import { loadStripe } from "@stripe/stripe-js";
import {
  Check,
  Pencil,
  Trash2,
  MoreHorizontal,
  Download,
  FileText,
  HelpCircle,
  X,
} from "lucide-react";

export default function Approvalpage() {
  const [expdoc, setexpdoc] = useState("Export Documents");
  const [spinner, setspinner] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModalOpenUpdate, setIsModalOpenUpdate] = useState(false);
  const [categories, setCategories] = useState([]);
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  var apiURL = "http://localhost:5000/api/user/";
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  document.title = "Approval Page";
  const [err, seterr] = useState(false);
  const { code } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    checkunicode();
    getcategories();
  }, []);
  const checkunicode = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
      code: code,
    };
    try {
      const res = await axios.post(apiURLAiFile + "checkunicode", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (res.data.results.length === 0) {
        navigate("/dataroom-Duediligence");
      }
    } catch (err) { }
  };
  const getcategories = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(apiURL + "getcategories", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      setCategories(res.data.results);
    } catch (err) { }
  };

  //Payments one time
  const apiUrlModule = "http://localhost:5000/api/admin/module/";

  const [dangerMessage, setdangerMessage] = useState("");
  const [dangerMessagealert, setdangerMessagealert] = useState("");
  const [getDataroompay, setgetDataroompay] = useState("");
  const [CheckOnetimePay, setCheckOnetimePay] = useState(false);
  useEffect(() => {
    getDataroompayment();
    getCheckOnetimePayment();
  }, []);
  const getDataroompayment = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(
        apiUrlModule + "getDataroompayment",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.row;

      setgetDataroompay(respo[0]);
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
  const [renew, setrenew] = useState(false);
  const getCheckOnetimePayment = async () => {
    let formData = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(
        apiUrlModule + "getCheckOnetimePayment",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      const respo = res.data.row;

      if (respo.length > 0) {
        const endDate = new Date(respo[0].end_date);
        const today = new Date();

        // Set both dates to midnight to ignore time
        endDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        if (today <= endDate) {
          setrenew(false);
          setCheckOnetimePay(true); // still active
        } else {
          setrenew(true);
          setCheckOnetimePay(false); // expired
        }
      } else {
        setrenew(false);
        setCheckOnetimePay(false);
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
  const [showPopup, setShowPopup] = useState(false);
  const [paynowOneTime, setpaynowOneTime] = useState(false);
  const [payinfo, setpayinfo] = useState(true);

  const [catgeoryId, setcatgeoryId] = useState("");
  const [subcatgeoryId, setsubcatgeoryId] = useState("");
  const [CategorynameFile, setCategorynameFile] = useState("");
  const handleUploadDocument = async (cat_id, sub_id) => {
    let formData = {
      cat_id: cat_id,
    };
    setOpenDocPopupKey(null);
    seteditdeleteBtn(null);
    try {
      const res = await axios.post(apiURLAiFile + "getcategoryname", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      const respo = res.data.row;
      setcatgeoryId(cat_id);
      setsubcatgeoryId(sub_id);
      if (CheckOnetimePay === false) {
        setShowPopup(true);
      } else {
        setIsModalOpen(true);
      }
      if (respo.length > 0) {
        setCategorynameFile(respo[0].name);
      } else {
        setCategorynameFile("Others");
      }
    } catch (err) { }
  };
  const handlePaynow = () => {
    setpaynowOneTime(true);
    setpayinfo(false);
  };
  const handleClosepayPopup = () => {
    setShowPopup(false);
    setpaynowOneTime(false);
  };
  const [editdeleteBtn, seteditdeleteBtn] = useState(null);
  const [DeleteIdDocs, setDeleteIdDocs] = useState("");
  const [openDocPopups, setOpenDocPopups] = React.useState({});
  const [openDocPopupKey, setOpenDocPopupKey] = useState(null);
  const [showDropdown, setShowDropdown] = useState(null);
  const [Docname, setDocname] = useState("");
  const handleEdit = (docId, docname) => {
    seteditdeleteBtn(null);

    setDocname(docname);
    setIsModalOpenUpdate(true);
  };

  const handleDelete = (docId) => {
    setdangerMessage("Are you sure? You want to delete this file");
  };

  const togglePopup = (categoryId, subcategoryId) => {
    const key = `${categoryId}-${subcategoryId}`;
    setOpenDocPopupKey((prevKey) => (prevKey === key ? null : key));
  };

  const refreshpage = () => {
    getcategories();
    setIsModalOpen(false);
  };

  const toggleDropdownEditDelete = (id) => {
    setDeleteIdDocs(id);
    seteditdeleteBtn((prevId) => (prevId === id ? null : id));
  };
  const handleConfirm = async () => {
    let formData = {
      id: DeleteIdDocs,
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "UserDocDeleteFile",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      getcategories();
      seteditdeleteBtn(null);
      setdangerMessage("");
      const respo = res.data.message;
      setdangerMessagealert(respo);
    } catch (err) { }
  };
  const handleDownload = async (userId, id, filename, folder_name) => {
    try {
      const response = await axios.post(
        apiURLAiFile + "filedownload",
        { userId, folderName: folder_name, filename },
        {
          responseType: "blob", // ✅ Important: tells axios to expect a binary file
        }
      );

      // Create blob URL and trigger download
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert("Download failed");
      console.error(err);
    }
  };
  const [IsModalOpenAiResponse, setIsModalOpenAiResponse] = useState(false);
  const [AIquestions, setAIquestions] = useState([]);
  const [IsModalOpenAiResponseSummary, setIsModalOpenAiResponseSummary] =
    useState(false);
  const [AiUpdatesummaryID, setAiUpdatesummaryID] = useState("");
  const [AISummary, setAISummary] = useState("");
  const handleEditViewSummary = async (id) => {
    let formData = {
      id: id,
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(apiURLAiFile + "getAISummary", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      if (res.data.status === 2) {
        setmessageshow("No results found");
        seterr(true);
        setTimeout(() => {
          seterr(false);
          setmessageshow("");
        }, 1500);
      } else {
        setmessageshow("");
        setAISummary(res.data.results);
        setIsModalOpenAiResponseSummary(true);
        if (res.data.row.length > 0) {
          setAiUpdatesummaryID(res.data.row[0].id);
        }
      }
    } catch (err) { }
  };
  const handleAttendAIquestion = async (id) => {
    let formData = {
      id: id,
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(apiURLAiFile + "getAISummary", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });

      if (res.data.row.length > 0) {
        setmessageshow("");
        setAiUpdatesummaryID(res.data.row[0].id);
        let formData = {
          id: res.data.row[0].id,
          company_id: userLogin.companies[0].id,
        };
        try {
          const res = await axios.post(
            apiURLAiFile + "getAIquestion",
            formData,
            {
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json", // Ensure the content type is JSON
              },
            }
          );

          setAIquestions(res.data.results);
          setIsModalOpenAiResponse(true);
        } catch (err) { }
      } else {
        setmessageshow("No results found");
        seterr(true);
        setTimeout(() => {
          seterr(false);
          setmessageshow("");
        }, 1500);
      }
    } catch (err) { }
  };
  const refreshpageAi = () => {
    setIsModalOpenAiResponse(false);
    setIsModalOpenAiResponseSummary(false);
    getcategories();
  };
  const handleApprovedFile = async (id) => {
    let formData = {
      id: id,
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(apiURLAiFile + "fileApproved", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });

      getcategories();
    } catch (err) { }
  };
  const [messageshow, setmessageshow] = useState("");
  const handleFinaldoc = async () => {
    let formData = {
      company_id: userLogin.companies[0].id,
      created_by_role: userLogin.role,
      created_by_id: userLogin.id,
      code: code,
    };
    setspinner(true);
    setexpdoc("Please wait....");
    try {
      const res = await axios.post(
        apiURLAiFile + "checkapprovedorNot",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      if (res.data.results.length > 0) {
        setexpdoc("Export Documents");
        setspinner(false);
        seterr(true);
        setmessageshow("All sections are required for approval");
        setTimeout(() => {
          seterr(false);
          setmessageshow("");
        }, 1500);
      } else {
        try {
          const res = await axios.post(
            apiURLAiFile + "generateDocFile",
            formData,
            {
              responseType: "blob",
              headers: {
                Accept:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "Content-Type": "application/json",
              },
            }
          );
          setspinner(false);
          setexpdoc("Export Documents");
          // Extract filename from header
          const contentDisposition = res.headers["content-disposition"];
          let filename = "download.docx"; // fallback

          if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match && match[1]) {
              filename = match[1];
            }
          }

          // Create a Blob and trigger download
          const blob = new Blob([res.data], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });

          const link = document.createElement("a");
          link.href = window.URL.createObjectURL(blob);
          link.download = filename;

          link.addEventListener("click", () => {
            setTimeout(() => {
              window.location.reload();
            }, 1000); // shorter delay since it's right after the click
          });

          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (error) {
          console.error("Download failed:", error);
        }
      }
    } catch (err) { }
  };
  const [viewsummay, setviewsummay] = useState(null);
  const toggleDropdownViewsummary = (name) => {
    setviewsummay((prev) => (prev === name ? null : name));
  };
  const [isCollapsed, setIsCollapsed] = useState(false);
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <div className="d-flex align-items-start gap-0">
            <ModuleSideNav
              isCollapsed={isCollapsed}
              setIsCollapsed={setIsCollapsed}
            />
            <div
              className={`global_view ${isCollapsed ? "global_view_col" : ""}`}
            >
              <TopBar />
              {dangerMessage && (
                <DangerAlertPopup
                  message={dangerMessage}
                  onConfirm={handleConfirm}
                  onCancel={() => {
                    setdangerMessage("");
                  }}
                />
              )}
              {dangerMessagealert && (
                <DangerAlertPopupMessage
                  message={dangerMessagealert}
                  onConfirm={handleConfirm}
                  onClose={() => {
                    setdangerMessagealert("");
                  }}
                />
              )}
              <SectionWrapper className="d-block p-md-4 p-3">
                {messageshow && (
                  <p className={err ? " mt-3 error_pop" : "success_pop mt-3"}>
                    {messageshow}
                  </p>
                )}
                <div className="container-fluid">
                  <DataRoomSection className="d-flex flex-column gap-4">
                    <div className="titleroom d-flex  justify-content-between align-items-center text-center">
                      <button
                        disabled={spinner}
                        style={{ opacity: spinner ? 0.6 : 1 }}
                        type="button"
                        onClick={handleFinaldoc}
                        className="generatebutton d-flex btn btn-outline-dark active gap-2"
                      >
                        <span>{expdoc}</span>
                        {spinner && (
                          <div
                            className=" spinner-border spinneronetimepay m-0"
                            role="status"
                          >
                            <span className="visually-hidden"></span>
                          </div>
                        )}
                      </button>

                      <h4 className="mainh1">Approval Page</h4>
                    </div>

                    <div className="table-responsive">
                      {categories.map((category) => {
                        const tooltipIdd = `tooltip-${category.category_id}`;
                        const tooltipIddd = `tooltipex-${category.category_id}`;
                        const tooltipIddd_doc = `tooltipDoc-${category.category_id}`;

                        return (
                          <div className="overflow-auto">
                            <table
                              key={category.id}
                              className="table document_table"
                            >
                              <thead>
                                <tr>
                                  <TableHeader>{category.name} </TableHeader>

                                  <TableHeader>Manage Documents</TableHeader>
                                  <TableHeader>
                                    {category.subcategories.length > 0 &&
                                      category.subcategories.some(
                                        (sub) =>
                                          sub.documents &&
                                          sub.documents.length > 0
                                      ) ? (
                                      category.approvedOrNot === "Yes" ? (
                                        <button
                                          style={{ fontSize: "0.7rem" }}
                                          className="btn btn-sm btn-success d-flex align-items-center gap-2 justify-content-center"
                                        >
                                          <Check width={16} />
                                          <span>Approved</span>
                                        </button>
                                      ) : (
                                        <button
                                          className="btn btn-sm btn-primary"
                                          onClick={() =>
                                            handleApprovedFile(category.id)
                                          }
                                        >
                                          Approve
                                        </button>
                                      )
                                    ) : null}
                                  </TableHeader>

                                  <TableHeader>
                                    <div className="d-flex align-items-center justify-content-end gap-4 position-relative">
                                      <span>AI OverView Click Here </span>
                                      <div className="d-flex justify-content-end overView_clixk">
                                        <button
                                          onClick={
                                            () =>
                                              toggleDropdownViewsummary(
                                                category.name
                                              ) // clickable
                                          }
                                          title="More actions"
                                          className="btn btn-link p-0 text-white"
                                          type="button"
                                        >
                                          <MoreHorizontal
                                            width={16}
                                            height={16}
                                            style={{
                                              color: "var(--primary-icon)",
                                            }}
                                          />
                                        </button>

                                        {viewsummay === category.name && (
                                          <div
                                            style={{
                                              position: "absolute",
                                              width: "200px",
                                              backgroundColor: "#fff",
                                              boxShadow:
                                                "0 2px 5px rgba(0,0,0,0.2)",
                                              padding: "2px",
                                              zIndex: 997,
                                              right: -9,
                                              top: 38,
                                            }}
                                          >
                                            <button
                                              type="button"
                                              title="View/Edit
                                                                                                      Summary"
                                              className="editdelete-links"
                                              onClick={() =>
                                                handleEditViewSummary(
                                                  category.id
                                                )
                                              }
                                            >
                                              <FileText
                                                className="me-1"
                                                width={12}
                                                height={10}
                                              />
                                              View/Edit Summary
                                            </button>
                                            <button
                                              type="button"
                                              title="View/Edit
                                                                                                      Summary"
                                              className="editdelete-links"
                                              onClick={() =>
                                                handleAttendAIquestion(
                                                  category.id
                                                )
                                              }
                                            >
                                              <HelpCircle
                                                className="me-1"
                                                width={12}
                                                height={10}
                                              />
                                              Attend AI Question Ans..
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </TableHeader>
                                </tr>
                              </thead>
                              {category.subcategories &&
                                category.subcategories.length > 0 ? (
                                <tbody>
                                  {category.subcategories.map((sub, index) => {
                                    const tooltipId = `tooltip-${category.id}-${sub.id}`;
                                    const key = `${category.id}-${sub.id}`;

                                    return (
                                      <tr key={sub.id}>
                                        <TableData>
                                          <h6>{sub.name}</h6>
                                        </TableData>

                                        <TableData>
                                          {sub.documents &&
                                            sub.documents.length > 0 ? (
                                            <>
                                              <UploadButton
                                                type="button"
                                                onClick={() =>
                                                  togglePopup(
                                                    category.id,
                                                    sub.id
                                                  )
                                                }
                                              >
                                                {openDocPopupKey ===
                                                  `${category.id}-${sub.id}`
                                                  ? "Hide Documents"
                                                  : "View Documents"}
                                              </UploadButton>

                                              {openDocPopupKey ===
                                                `${category.id}-${sub.id}` && (
                                                  <div className="popupDataRoom">
                                                    <div className="uploadFilescroll position-relative">
                                                      <div className="d-flex mb-2 pop_bg justify-content-between align-items-center p-2">
                                                        <h4 className="docName">
                                                          {sub.name}
                                                        </h4>
                                                        <div className="d-flex gap-2 align-items-center">
                                                          <button
                                                            type="button"
                                                            className="bg-transparent text-white p-1 border-0"
                                                            onClick={() =>
                                                              togglePopup(
                                                                category.id,
                                                                sub.id
                                                              )
                                                            }
                                                          >
                                                            <IoCloseCircleOutline
                                                              size={24}
                                                            />
                                                          </button>
                                                        </div>
                                                      </div>

                                                      <ol className="text-start text-capitalize pdflist">
                                                        {sub.documents.map(
                                                          (doc) => (
                                                            <li
                                                              key={doc.id}
                                                              className="  "
                                                            >
                                                              <span className="d-flex justify-content-between align-items-center">
                                                                {doc.name}

                                                                <div className="d-inline ms-2">
                                                                  <button
                                                                    title="More actions"
                                                                    className="btn btn-link p-0 text-dark"
                                                                    type="button"
                                                                    onClick={() =>
                                                                      toggleDropdownEditDelete(
                                                                        doc.id
                                                                      )
                                                                    }
                                                                  >
                                                                    <MoreHorizontal
                                                                      width={16}
                                                                      height={16}
                                                                    />
                                                                  </button>
                                                                  {editdeleteBtn ===
                                                                    doc.id && (
                                                                      <div
                                                                        style={{
                                                                          position:
                                                                            "absolute",
                                                                          width:
                                                                            "100px",
                                                                          backgroundColor:
                                                                            "#fff",
                                                                          boxShadow:
                                                                            "0 2px 5px rgba(0,0,0,0.2)",
                                                                          padding:
                                                                            "2px",
                                                                          zIndex: 997,
                                                                          right: 0,
                                                                        }}
                                                                      >
                                                                        <button
                                                                          type="button"
                                                                          title="Download"
                                                                          className="editdelete-links"
                                                                          onClick={() =>
                                                                            handleDownload(
                                                                              doc.user_id,
                                                                              doc.id,
                                                                              doc.name,
                                                                              doc.folder_name
                                                                            )
                                                                          }
                                                                        >
                                                                          <Download
                                                                            className="me-1"
                                                                            width={
                                                                              10
                                                                            }
                                                                            height={
                                                                              10
                                                                            }
                                                                          />
                                                                          Download
                                                                        </button>
                                                                      </div>
                                                                    )}
                                                                </div>
                                                              </span>
                                                            </li>
                                                          )
                                                        )}
                                                      </ol>
                                                      <button
                                                        className=" btn btn-outline-dark "
                                                        type="button"
                                                        onClick={() =>
                                                          togglePopup(
                                                            category.id,
                                                            sub.id
                                                          )
                                                        }
                                                      >
                                                        <FaTimes />
                                                      </button>
                                                    </div>
                                                  </div>
                                                )}
                                            </>
                                          ) : (
                                            <span>--</span>
                                          )}
                                        </TableData>
                                        <TableData></TableData>
                                        <TableData></TableData>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              ) : (
                                <tbody>
                                  <tr>
                                    <TableData colSpan={5}>
                                      <p>No subcategories</p>
                                    </TableData>
                                  </tr>
                                </tbody>
                              )}
                            </table>
                          </div>
                        );
                      })}
                    </div>
                  </DataRoomSection>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>

      {/* pop up */}
      {isModalOpen && (
        <UploadModal
          onClose={() => setIsModalOpen(false)}
          catgeoryId={catgeoryId}
          subcatgeoryId={subcatgeoryId}
          CategorynameFile={CategorynameFile}
          refreshpage={refreshpage}
        />
      )}
      {isModalOpenUpdate && (
        <UploadModalUpdate
          onClose={() => setIsModalOpenUpdate(false)}
          catgeoryId={catgeoryId}
          subcatgeoryId={subcatgeoryId}
          CategorynameFile={CategorynameFile}
          refreshpage={refreshpage}
          Docname={Docname}
          DeleteIdDocs={DeleteIdDocs}
        />
      )}
      {IsModalOpenAiResponse && (
        <AiQuestionForm
          onClose={() => setIsModalOpenAiResponse(false)}
          catgeoryId={catgeoryId}
          subcatgeoryId={subcatgeoryId}
          CategorynameFile={CategorynameFile}
          refreshpageAi={refreshpageAi}
          Docname={Docname}
          DeleteIdDocs={DeleteIdDocs}
          AIquestions={AIquestions}
        />
      )}
      {IsModalOpenAiResponseSummary && (
        <AiSummaryForm
          onClose={() => setIsModalOpenAiResponseSummary(false)}
          AiUpdatesummaryID={AiUpdatesummaryID}
          refreshpageAi={refreshpageAi}
          AISummary={AISummary}
        />
      )}
      {showPopup && (
        <div
          className="modal fade show d-block"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          tabIndex="-1"
          role="dialog"
          aria-labelledby="paymentModalLabel"
          aria-hidden="false"
        >
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content rounded-4 shadow-lg p-4">
              <button
                type="button"
                className="btn-close position-absolute top-0 end-0 m-3"
                onClick={handleClosepayPopup}
                aria-label="Close"
              ></button>
              {payinfo && (
                <>
                  <h2
                    className="modal-title text-center fw-bold text-dark mb-4"
                    id="paymentModalLabel"
                  >
                    Payment For {renew && "Renew"}
                  </h2>
                  <div className="mb-4">
                    <h5 className="fw-bold text-dark mb-2">
                      Dataroom Management & Diligence
                    </h5>
                  </div>
                  <div className="mb-4">
                    <div className="fs-4 fw-semibold text-dark">
                      Fee:{" "}
                      <span style={{ color: "#2e5692" }} className="fw-bold">
                        €500
                      </span>{" "}
                      <span className="fs-6 text-muted">(One-Time)</span>
                    </div>
                    <ul className="list-group list-group-flush mt-3">
                      <li className="list-group-item text-dark ps-0">
                        Access to Dataroom for 3 months
                      </li>
                      <li className="list-group-item text-dark ps-0">
                        Includes uploading of documents
                      </li>
                      <li className="list-group-item text-dark ps-0">
                        Due diligence documents can be generated{" "}
                        <strong>2 times</strong>
                      </li>
                      <li className="list-group-item text-dark ps-0">
                        Additional generation:{" "}
                        <strong>€100 per instance</strong>
                      </li>
                    </ul>
                  </div>
                </>
              )}
              <div className="text-center mb-4">
                <img
                  src="/assets/user/images/cardimage.jpg"
                  alt="cards"
                  className="img-fluid rounded"
                  style={{ maxWidth: "200px" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
