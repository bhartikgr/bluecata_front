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
import { IoCloseCircleOutline } from "react-icons/io5";
import axios from "axios";
const AiInvestorReport = ({
  onClose,
  AiUpdatesummaryID,
  refreshpageAi,
  AISummary,
}) => {
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);

  const [errMessage, seterrMessage] = useState("");
  const [spinners, setspinners] = useState(false);

  const [aitext, setaitext] = useState(AISummary);
  const [answers, setAnswers] = useState({});
  const [successresponse, setsuccessresponse] = useState(false);
  const [message, setmessage] = useState("");
  const [err, seterr] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();

    let payload = {
      aisummary: e.target.aisummary.value,
      id: AiUpdatesummaryID,
      company_id: userLogin.companies[0].id,
    };
    try {
      await axios.post(
        apiURLAiFile + "aisummaryInvestorreportUpdate",
        payload,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setmessage("Investor report updated successfully");

      setTimeout(() => {
        refreshpageAi();
        setmessage("");
      }, 2000);
    } catch (err) {
      console.error("Submit error:", err);
    }
  };

  return (
    <Overlay>
      <ModalContainer>
        {message && (
          <p className={err ? " mt-3 error_pop" : "success_pop mt-3"}>
            {message}
          </p>
        )}
        <form onSubmit={handleSubmit} method="post" action="javascript:void(0)">
          <div className="formmodal">
            <div className="d-flex align-items-center gap-3 mb-3 justify-content-between">
              <h5 className="modal-title " id="resetPasswordModalLabel">
                AI Summary
              </h5>
              <button
                type="button"
                className="close_btn_global"
                onClick={onClose}
                aria-label="Close"
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>
            <div className="form-group pb-3">
              <textarea
                className="form-control scroll_nonw"
                name="aisummary"
                rows="12"
                placeholder="Enter your answer..."
                defaultValue={aitext}
                required
              />
            </div>

            {errMessage && (
              <span className="text-danger fileerror">{errMessage}</span>
            )}
            {successresponse && (
              <span className="text-success fileerror">
                Updated successfully
              </span>
            )}
          </div>

          <ButtonGroup>
            <ModalBtn className="global_btn_close" onClick={onClose}>
              Close
            </ModalBtn>
            <ModalBtn
              disabled={spinners}
              variant="upload"
              type="submit"
              style={{ opacity: spinners ? 0.6 : 1 }}
              className="global_btn d-flex align-items-center gap-2"
            >
              Save
            </ModalBtn>
          </ButtonGroup>
        </form>
      </ModalContainer>
    </Overlay>
  );
};

export default AiInvestorReport;
