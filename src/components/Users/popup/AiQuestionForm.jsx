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
const AiQuestionForm = ({
  onClose,
  catgeoryId,
  subcatgeoryId,
  CategorynameFile,
  refreshpageAi,
  Docname,
  DeleteIdDocs,
  AIquestions,
}) => {
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [errMessage, seterrMessage] = useState("");
  const [spinners, setspinners] = useState(false);
  const [filenamecheck, setfilenamecheck] = useState(Docname);
  const [loopAiquestion, setloopAiquestion] = useState(AIquestions);
  const [answers, setAnswers] = useState({});
  const [successresponse, setsuccessresponse] = useState(false);
  useEffect(() => {
    if (loopAiquestion && loopAiquestion.length > 0) {
      const initialAnswers = {};
      loopAiquestion.forEach((q) => {
        initialAnswers[q.id] = q.answer || ""; // pre-fill if answer already exists
      });
      setAnswers(initialAnswers);
    }
  }, [loopAiquestion]);
  const handleAnswerChange = (id, value) => {
    setAnswers((prev) => ({
      ...prev,
      [id]: value,
    }));
  };
  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = loopAiquestion.map((q) => ({
      questionId: q.id,
      question: q.questions,
      answer: answers[q.id] || "",
      updated_by_id: userLogin.id,
      updated_by_role: userLogin.role,
      company_id: userLogin.companies[0].id,
      dataroomdocuments_id: q.dataroomdocuments_id, // assuming this exists
    }));
    try {
      await axios.post(apiURLAiFile + "RespoonseAIquestion", payload, {
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
            <ModalTitle className="aititle pb-3">AI Question</ModalTitle>
            {loopAiquestion.length === 0 && <span>No AI Questions</span>}

            {loopAiquestion.map((q, index) => (
              <div
                key={q.id}
                className="form-group mb-3 d-flex flex-column gap-2"
              >
                <label>Question {index + 1}</label>

                <h4 className="mb-2 mainp ">{q.questions}</h4>

                <textarea
                  className="textarea_input"
                  rows="3"
                  placeholder="Enter your answer..."
                  value={answers[q.id] || ""}
                  onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                  required
                />
              </div>
            ))}
          </div>
          {errMessage && (
            <span className="text-danger fileerror">{errMessage}</span>
          )}
          {successresponse && (
            <span className="text-success fileerror">Updated successfully</span>
          )}
          {loopAiquestion.length > 0 && (
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
          )}
        </form>
      </ModalContainer>
    </div>
  );
};

export default AiQuestionForm;
