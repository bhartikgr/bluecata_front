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
const AiSummaryForm = ({
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

  const handleSubmit = async (e) => {
    e.preventDefault();

    let payload = {
      aisummary: e.target.aisummary.value,
      id: AiUpdatesummaryID,
      company_id: userLogin.companies[0].id,
    };
    try {
      await axios.post(apiURLAiFile + "aisummaryUpdate", payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setsuccessresponse(true);
      setTimeout(() => {
        refreshpageAi();
        setsuccessresponse(false);
      }, 2000);
    } catch (err) {
      console.error("Submit error:", err);
    }
  };

  return (
    <div className="main_popup-overlay">
      <ModalContainer>
        <form onSubmit={handleSubmit} method="post" action="javascript:void(0)">
          <CloseButton onClick={onClose}>×</CloseButton>
          <div className="formmodal">
            <ModalTitle className="aititle pb-3">AI Summary</ModalTitle>

            <div className="form-group mb-3">
              <textarea
                className="form-control"
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
            <ModalBtn onClick={onClose} className="close_btn w-fit">
              Close
            </ModalBtn>
            <ModalBtn
              disabled={spinners}
              variant="upload"
              type="submit"
              style={{ opacity: spinners ? 0.6 : 1 }}
              className="global_btn w-fit align-items-center gap-2"
            >
              Save
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

export default AiSummaryForm;
