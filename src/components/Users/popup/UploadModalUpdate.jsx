import React, { useState } from "react";
import {
  Overlay,
  ModalContainer,
  ModalTitle,
  CloseButton,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";
import { IoCloseCircleOutline } from "react-icons/io5";
import axios from "axios";
const UploadModalUpdate = ({
  onClose,
  catgeoryId,
  subcatgeoryId,
  CategorynameFile,
  refreshpage,
  Docname,
  DeleteIdDocs,
  docId,
}) => {
  var apiURL = "http://localhost:5000/api/user/aifile/";
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [errMessage, seterrMessage] = useState("");
  const [spinners, setspinners] = useState(false);
  const [filenamecheck, setfilenamecheck] = useState(Docname);
  const [errr, seterrr] = useState(false);
  const [file_error, setfile_error] = useState("");
  const [message, setMessage] = useState("");
  const handleUpload = async (event) => {
    // send to backend or extract in browser (basic types only like .txt/.doc)
    if (selectedFiles.length === 0) {
      seterrMessage("Please choose the file");
      setTimeout(() => {
        seterrMessage("");
      }, 1000);
    } else {
      setspinners(true);
      seterrMessage("");
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append("documents", file);
      });
      formData.append("company_id", userLogin.companies[0].id);
      formData.append("updated_by_role", userLogin.role);
      formData.append("updated_by_id", userLogin.id);
      formData.append("catgeoryId", catgeoryId);
      formData.append("subcatgeoryId", subcatgeoryId);
      formData.append("filetype", CategorynameFile);
      formData.append("documentId", DeleteIdDocs);

      try {
        const response = await axios.post(
          apiURL + "uploadDocumentsEdit",
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          }
        );
        if (response.data.status === "2") {
          const failedFiles = response.data.failedFiles || [];

          // Optional: log or display failed filenames
          const failedFileNames = failedFiles
            .map((file) => file.filename)
            .join(", ");
          const derr = `${response.data.message}:\n${failedFileNames}`;
          setfile_error(derr);
          setspinners(false);
          setTimeout(() => {
            setfile_error("");
          }, 1500);
        } else {
          setMessage("File updated successfully");
          setTimeout(() => {
            setMessage("");
            refreshpage();
            setspinners(false);
            onClose();
          }, 1200);
        }
      } catch (err) {
        alert("Failed to upload or process document");
      }
    }
  };
  const handleFile = (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      if (files.length > 10) {
        seterrMessage("You can upload a maximum of 10 files only.");
        setSelectedFiles([]);
      } else {
        seterrMessage("");
        const fileArray = Array.from(files);
        setSelectedFiles(fileArray);

        // ✅ Set the first selected file name as title
        if (fileArray.length === 1) {
          setfilenamecheck(fileArray[0].name);
        } else {
          setfilenamecheck(`${fileArray.length} files selected`);
        }
      }
    }
  };

  return (
    <div className="main_popup-overlay">
      <ModalContainer>
        <form onSubmit={handleUpload} method="post" action="javascript:void(0)">
          <div className="d-flex align-items-center gap-3 mb-3 justify-content-between">
            <ModalTitle>
              Upload documents (PDF, MS Word, MS Excel, Text Notes)
            </ModalTitle>
            <button
              type="button"
              className="close_btn_global"
              onClick={onClose}
              aria-label="Close"
            >
              <IoCloseCircleOutline size={24} />
            </button>
          </div>

          <h4 className="mb-3 fn_size_sm">Edit: {Docname}</h4>

          {message && (
            <p className={errr ? " mt-3 error_pop" : "success_pop mt-3"}>
              {message}
            </p>
          )}
          <DropArea>
            <h6>
              <b>Click to select files</b>
            </h6>
            <p>or drag it here.</p>
            <input
              type="file"
              name="documents"
              accept=".pdf, .doc, .docx, .xls, .xlsx, .txt, .jpg, .jpeg, .png, .bmp, .tiff, .gif"
              onChange={handleFile}
            />

            {selectedFiles.length > 0 && (
              <div>
                <span>{selectedFiles.length} File</span>
              </div>
            )}
          </DropArea>
          {file_error && (
            <span className="text-danger fileerror">{file_error}</span>
          )}
          {errMessage && (
            <span className="text-danger fileerror">{errMessage}</span>
          )}
          <ButtonGroup>
            <ModalBtn onClick={onClose} className="close_btn w-fit">
              Close
            </ModalBtn>
            <ModalBtn
              disabled={spinners}
              variant="upload"
              type="submit"
              style={{ opacity: spinners ? 0.6 : 1 }}
              className="global_btn w-fit d-flex align-items-center gap-2"
            >
              Update
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
        </form>
      </ModalContainer>
    </div>
  );
};

export default UploadModalUpdate;
