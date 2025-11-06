import React from "react";

import {
  Overlay,
  ModalContainer,
  ModalTitle,
  CloseButton,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";

const UploadModal = ({ onClose }) => {
  const handleUpload = () => {
    // your upload logic here
    alert("File uploaded!");
    onClose();
  };

  return (
    <Overlay>
      <ModalContainer>
        <CloseButton onClick={onClose}>×</CloseButton>
        <ModalTitle>Upload documents ( POF, PPT, JPG, PNG, EXCEL )</ModalTitle>
        <DropArea>
          <h6>
            <b>Click to select files</b>
          </h6>
          <p>or drag it here.</p>
          <input type="file" multiple />
        </DropArea>
        <ButtonGroup>
          <ModalBtn onClick={onClose}>Close</ModalBtn>
          <ModalBtn variant="upload" onClick={handleUpload}>
            Submit
          </ModalBtn>
        </ButtonGroup>
      </ModalContainer>
    </Overlay>
  );
};

export default UploadModal;
