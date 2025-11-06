import styled from "styled-components";

// export const Wrapper = styled.div`
//   input,
//   textarea,
//   select,
//   a,
//   p,
//   h1,
//   h2,
//   h3,
//   h4,
//   h5,
//   h6 {
//     margin: 0;
//     text-decoration: none;
//     outline: none;
//     word-break: break-word;
//     overflow-wrap: break-word;
//   }

//   input:focus,
//   textarea:focus,
//   select:focus {
//     outline: none;
//     box-shadow: none;
//     border-color: inherit;
//   }
// `;

export const DataRoomSection = styled.div`
  background-color: #fff;

  color: #000;
`;

// Title
export const Title = styled.h2`
  color: var(--primary) !important;
  font-weight: 700;
  font-size: 2rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 1rem;
`;

// Table header cells
export const TableHeader = styled.th`
  background-color: #efefef !important;
  color: #000 !important;
  text-align: center;
  vertical-align: middle;
  font-size: 0.8rem;
  text-transform: capitalize;

  &:first-child {
    text-align: start;
  }
`;

// Table data cells
export const TableData = styled.td`
  vertical-align: middle;
  text-align: center;

  h6 {
    font-size: 0.8rem;
    font-weight: 500;
    text-transform: capitalize;
    text-align: start;
    color: #000;
  }

  h5 {
    font-size: 13px;
    font-weight: 400;
    color: var(--primary) !important;
    text-transform: capitalize;
  }

  p {
    font-size: 13px;
    color: #000;
    margin: 0;
    text-transform: capitalize;
  }
`;

// Upload Button
export const UploadButton = styled.button`
  background-color: var(--primary) !important;
  color: #fff;
  border: none;
  padding: 4px 10px;
  font-weight: 400;
  font-size: 12px;
  border-radius: 4px;
  text-transform: capitalize;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    background-color: #000;
  }
`;

export const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  z-index: 999;
`;

export const ModalContainer = styled.div`
  background: #fff;
  width: 90%;
  max-width: 700px;
  padding: 1.5rem;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: auto;
  border-radius: 12px;
  position: fixed;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  z-index: 1000;
  max-height: 90vh;
  overflow-y: auto;
  overflow-x: hidden;

  /* Responsive adjustments */
  @media (max-width: 768px) {
    width: 95%;
    padding: 1.5rem;
    border-radius: 8px;
  }

  @media (max-width: 480px) {
    width: 100%;
    margin: 0;
    border-radius: 0;
    padding: 1.25rem;
    max-height: 100vh;
    height: 100vh;
    overflow-y: auto;
  }

  /* Scrollbar styling for webkit browsers */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: #c5c5c5;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
  }
`;

export const ModalContainer1 = styled.div`
  background: #fff;
  width: 90%;
  max-width: 700px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: auto;
  border-radius: 12px;
  padding: 2rem;
  position: fixed;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  z-index: 1000;
  max-height: 90vh;
  /* Responsive adjustments */
  @media (max-width: 768px) {
    width: 95%;
    padding: 1.5rem;
    border-radius: 8px;
  }

  @media (max-width: 480px) {
    width: 100%;
    margin: 0;
    border-radius: 0;
    padding: 1.25rem;
    max-height: 100vh;
    height: 100vh;
    overflow-y: auto;
  }

  /* Scrollbar styling for webkit browsers */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: #c5c5c5;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
  }
`;

export const ModalTitle = styled.h3`
  color: var(--dark) !important;
  font-weight: semibold;
  font-size: 1rem;
`;

export const CloseButton = styled.button`
  position: absolute;
  top: -30px;
  right: -30px;
  border: none;
  font-size: 20px;
  font-weight: bold;
  color: #000;
  cursor: pointer;
  background: #fff;
  height: 40px;
  width: 40px;
  padding: 0 0 5px 0;
  line-height: 0;
  border-radius: 100px;
`;

export const DropArea = styled.label`
  border: 2px dashed var(--primary) !important;
  border-radius: 6px;
  padding: 2rem;
  text-align: center;
  cursor: pointer;
  color: #000;
  margin-bottom: 1.5rem;
  position: relative;
  width: 100%;

  input[type="file"] {
    opacity: 0;
    width: 100%;
    height: 100%;
    position: absolute;
    left: 0;
    top: 0;
    cursor: pointer;
  }
`;

export const ButtonGroup = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  font-size: 14px;
`;

export const ModalBtn = styled.button`
  font-size: 14px;
  padding: 0.6rem 1.2rem;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: background-color 0.3s ease;
`;

export const FormProfile = styled.div`
  display: block;

  form {
    label {
      font-size: 14px;
      font-weight: 500;
      display: block;
    }

    input {
      padding: 0.6rem 1rem;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 14px;
      width: 100%;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: var(--primary) !important;
        box-shadow: none;
      }
    }

    button[type="submit"] {
      font-size: 14px;
      padding: 0.6rem 1.2rem;
      font-weight: 600;
      border: none;
      border-radius: 4px;
      color: #fff;
      background-color: var(--primary);
      cursor: pointer;
      transition: background-color 0.3s ease;

      &:hover {
        background-color: #2a406c;
      }
    }
  }
`;
