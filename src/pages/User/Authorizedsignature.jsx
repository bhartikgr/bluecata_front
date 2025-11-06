import React, { useState, useRef, useEffect } from "react";
import TopBar from "../../components/Users/TopBar";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import SignaturePad from "react-signature-canvas"; // npm install react-signature-canvas
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Wrapper,
  SectionWrapper,
} from "../../components/Styles/RegisterStyles";
import axios from "axios";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
export default function Authorizedsignature() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  document.title = "Authorized Signature";
  const [signatureMethod, setSignatureMethod] = useState(""); // "upload" | "manual" | "pad"
  const [uploadedFile, setUploadedFile] = useState(null);
  const [manualSignature, setManualSignature] = useState("");
  const [dangerMessage, setdangerMessage] = useState("");
  const [errr, seterrr] = useState(false);
  const [authorizedData, setAuthorizedData] = useState(null);
  const [ClientIP, setClientIP] = useState("");
  const sigPadRef = useRef(null);
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const apiURLSignature = "http://localhost:5000/api/user/";
  // Select method and reset others
  const selectMethod = (method) => {
    setSignatureMethod(method);
    if (method !== "upload") setUploadedFile(null);
    if (method !== "manual") setManualSignature("");
    if (method !== "pad" && sigPadRef.current) sigPadRef.current.clear();
  };
  useEffect(() => {
    const getIP = async () => {
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        setClientIP(data.ip); // Save this to state
      } catch (error) {
        console.error("Failed to fetch IP", error);
      }
    };

    getIP();
  }, []);
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
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setUploadedFile(file);
  };
  const handleSubmit = async () => {
    // Validation
    if (!signatureMethod) {
      seterrr(true);
      setdangerMessage("Please select a signature method!");
      return;
    }

    if (
      (signatureMethod === "upload" && !uploadedFile) ||
      (signatureMethod === "manual" && !manualSignature) ||
      (signatureMethod === "pad" && sigPadRef.current?.isEmpty())
    ) {
      seterrr(true);
      setdangerMessage(
        "Please provide your signature for the selected method!"
      );

      return;
    }

    // Prepare FormData
    const formData = new FormData();
    formData.append("method", signatureMethod);
    formData.append("company_id", userLogin.companies[0].id);
    formData.append("signatory_id", userLogin.id);
    formData.append("email", userLogin.email);
    formData.append("ip_address", ClientIP);
    if (signatureMethod === "upload") {
      formData.append("file", uploadedFile);
    } else if (signatureMethod === "manual") {
      formData.append("manual", manualSignature);
    } else if (signatureMethod === "pad") {
      const dataURL = sigPadRef.current.toDataURL();
      formData.append("signature_pad", dataURL);
    }

    try {
      const res = await axios.post(
        `${apiURLSignature}authorizedSignature`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data", // important for file upload
          },
        }
      );
      seterrr(false);
      setdangerMessage(
        "Signature submitted successfully and awaiting company owner approval"
      );
      setTimeout(() => {
        getAuthorizedSignature();
        seterrr(false);
        setdangerMessage("");
      }, 3000);
    } catch (err) {
      console.error("Error submitting signature:", err);
      alert("Error submitting signature. Please try again.");
    }
  };

  return (
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
            <SectionWrapper className="d-block p-md-4 p-3">
              <div className="container-fluid">
                <div className="subscription-header">
                  <div className="subscription-title">
                    <h1>Authorized Signature</h1>
                    <p>Select one method to submit your signature</p>
                  </div>
                </div>
                {dangerMessage && (
                  <div
                    className={`flex items-center justify-between gap-3 shadow-lg ${errr ? "error_pop" : "success_pop"
                      }`}
                  >
                    <div className="d-flex align-items-center gap-2">
                      <span className="d-block">{dangerMessage}</span>
                    </div>

                    <button
                      type="button"
                      className="close_btnCros"
                      onClick={() => setdangerMessage("")}
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="row gy-3 py-3">
                  {authorizedData ? (
                    <div className="col-md-12">
                      <h5>Saved Signature:</h5>
                      <p>
                        Status:{" "}
                        <strong
                          style={{
                            color:
                              authorizedData.approve === "Yes"
                                ? "green"
                                : "red",
                          }}
                        >
                          {authorizedData.approve === "Yes"
                            ? "Approved"
                            : "Not Approved"}
                        </strong>
                      </p>
                      {authorizedData.type === "upload" && (
                        <img
                          src={`http://localhost:5000/api/upload/docs/doc_${authorizedData.company_id}/signatory/${authorizedData.signature}`}
                          alt="Uploaded Signature"
                          style={{ maxWidth: "300px" }}
                        />
                      )}
                      {authorizedData.type === "manual" && (
                        <div
                          dangerouslySetInnerHTML={{
                            __html: authorizedData.signature,
                          }}
                          style={{
                            border: "1px solid #ced4da",
                            padding: "10px",
                            minHeight: "120px",
                          }}
                        />
                      )}
                      {authorizedData.type === "pad" && (
                        <img
                          src={authorizedData.signature} // base64 image
                          alt="Signature Pad"
                          style={{ maxWidth: "300px" }}
                        />
                      )}
                    </div>
                  ) : (
                    // Show signature input form
                    <>
                      {/* Method Selection */}
                      {["manual", "pad"].map((method) => (
                        <div className="col-md-4" key={method}>
                          <button
                            onClick={() => selectMethod(method)}
                            style={{
                              width: "100%",
                              backgroundColor:
                                signatureMethod === method
                                  ? "#F63C3F"
                                  : "transparent",
                              borderColor: "#F63C3F",
                              color:
                                signatureMethod === method ? "#fff" : "#F63C3F",
                              padding: "10px",
                              borderRadius: "5px",
                              borderWidth: "1px",
                              borderStyle: "solid",
                              cursor: "pointer",
                            }}
                          >
                            {method === "manual"
                              ? "Manual Signature"
                              : "Signature Pad"}
                          </button>
                        </div>
                      ))}

                      {/* Upload Input removed, no need for conditional rendering */}

                      {/* Manual Signature Input */}
                      {signatureMethod === "manual" && (
                        <div className="col-md-12 mt-3">
                          <ReactQuill
                            theme="snow"
                            value={manualSignature}
                            onChange={setManualSignature}
                            placeholder="Type your signature here"
                            modules={{
                              toolbar: [
                                ["bold", "italic", "underline"],
                                [{ size: [] }],
                                [{ color: [] }, { background: [] }],
                                ["clean"],
                              ],
                            }}
                            formats={[
                              "bold",
                              "italic",
                              "underline",
                              "size",
                              "color",
                              "background",
                            ]}
                            style={{ minHeight: "120px" }}
                          />
                        </div>
                      )}

                      {/* Signature Pad */}
                      {signatureMethod === "pad" && (
                        <div className="col-md-12 mt-3">
                          <SignaturePad
                            ref={sigPadRef}
                            canvasProps={{
                              width: 500,
                              height: 200,
                              className: "border",
                            }}
                          />
                          <button
                            className="btn btn-warning mt-2 text-white"
                            onClick={() =>
                              sigPadRef.current && sigPadRef.current.clear()
                            }
                          >
                            Clear Signature
                          </button>
                        </div>
                      )}

                      {/* Submit */}
                      <div className="col-md-12 mt-4">
                        <button
                          className="global_btn w-fit px-4 py-2 fn_size_sm active d-flex align-items-center gap-2"
                          onClick={handleSubmit}
                        >
                          Submit Signature
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </SectionWrapper>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
