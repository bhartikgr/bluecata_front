import styled from "styled-components";

export const VideoPopupStyles = styled.div`
  .video-popup-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(10px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .video-popup-content {
    position: relative;
    width: 90%;
    max-width: 1024px;
    aspect-ratio: 16/9;
    background: #000;
  }

  .video-container {
    width: 100%;
    height: 100%;
    iframe {
      aspect-ratio: 16/9;
      height: auto;
      width: 100%;
    }
  }

  .close-button {
    position: absolute;
    top: -40px;
    right: 0;
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 8px;
    z-index: 1001;

    &:hover {
      opacity: 0.8;
    }
  }
`;
