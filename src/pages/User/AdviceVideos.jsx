import React, { useState, useRef, useEffect } from "react";
import MainHeader from "../../components/Users/MainHeader";
import TopBar from "../../components/Users/TopBar";
import {
  SectionWrapper,
  Stepblock,
  Titletext,
  GalleryWrapper,
  VideoThumbnail,
  ModalOverlay,
  ModalContent,
  CloseButton,
} from "../../components/Styles/AdviceVideoStyles.js";

import {
  Overlay,
  Popup,
  CloseBtn,
  CardImageContainer,
  CardImage,
  TitlePay,
  Form,
  FormGroup,
  Label,
  Input,
  Row,
  ButtonGroup,
  Button,
  Wrapper,
} from "../../components/Styles/MainStyle.js";
import PaymentPopupAcademy from "../../components/Users/PaymentPopupAcademy"; // Adjust path
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import axios from "axios";
export default function AdviceVideos() {
  const [errr, seterrr] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [allRecordVideo, setAllrecordvideo] = useState([]);
  const [errorMsg, seterrorMsg] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null);
  const videoRef = useRef();
  const backendpath = "http://localhost:5000/api/upload/video";
  const apiUrl = "http://localhost:5000/api/user/";
  const apiUrlModule = "http://localhost:5000/api/admin/module/";
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [moduledata, setmoduledata] = useState("");
  const [showPopupPay, setShowPopupPay] = useState(false);
  const [getDataroompay, setgetDataroompay] = useState("");
  const [checkModulesub, setcheckModulesub] = useState("");
  useEffect(() => {
    document.title = "Investor Presentation Structure - Expert Advice Video";
  }, []);
  useEffect(() => {
    // Disable right-click
    const handleContextMenu = (e) => e.preventDefault();
    document.addEventListener("contextmenu", handleContextMenu);

    // Disable F12, Ctrl+Shift+I, Ctrl+U
    const handleKeydown = (e) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && e.key === "I") ||
        (e.ctrlKey && e.key === "u")
      ) {
        e.preventDefault();
        // alert("Developer tools are disabled for security reasons.");
      }
    };
    document.addEventListener("keydown", handleKeydown);

    // Detect DevTools opening (approximate)
    const detectDevTools = () => {
      const threshold = 160; // Approximate width/height when DevTools opens
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold =
        window.outerHeight - window.innerHeight > threshold;

      if (widthThreshold || heightThreshold) {
        //alert("Developer tools detected. Access is restricted.");
        // Optionally redirect or close modal
        setIsModalOpen(false);
        setSelectedVideo(null);
      }
    };

    const interval = setInterval(detectDevTools, 1000);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeydown);
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    checkmodulesubscription();
  }, []);
  const checkmodulesubscription = async () => {
    let formdata = {
      id: "",
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiUrl + "checkmodulesubscription",
        formdata,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      if (res.data.results.length > 0) {
        setcheckModulesub("1");
      }
    } catch (err) { }
  };
  useEffect(() => {
    // checkemail();
    getDataroompayment();
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

      setgetDataroompay(respo[0].academy_Fee);
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
  const openModal = (video) => {
    if (checkModulesub === "") {
      setShowPopupPay(true);
      return;
    }
    setSelectedVideo(null);

    const videoKey = `video_${video.id}_views`; // unique key for each video
    const videoPath = video.video;
    setSelectedVideo(`${backendpath}/${videoPath}`);
    videolimitsave(video);
  };

  const videolimitsave = async (video) => {
    let formData = {
      user_id: userLogin.id,
      video_id: video.id,
      limit: video.max_limit,
    };
    try {
      const res = await axios.post(apiUrl + "videolimitsave", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      if (respo.status === "2") {
        setSelectedVideo(null);
        seterrr(true);
        seterrorMsg(respo.message);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
          }
          //  setShowPopup(true);
          seterrorMsg("");
        }, 1800);
      } else {
        seterrorMsg("");
        setIsModalOpen(true);
        setTimeout(() => {
          videoRef.current?.play();
        }, 100);
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

  const closeModal = () => {
    setIsModalOpen(false);

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setSelectedVideo(null);
  };

  const apiUrlVideo = "http://localhost:5000/api/admin/video/";
  useEffect(() => {
    getvideo();
  }, []);
  const getvideo = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrlVideo + "getvideolist", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setAllrecordvideo(respo);
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

  const handleSubmit = (e) => {
    e.preventDefault();
    // handle form submission
    console.log(e.target);
    setShowPopup(false);
  };
  const handleSubmitPay = () => { };
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
              <SectionWrapper className="d-block p-md-4 p-3">
                <div className="container-fluid">
                  {errorMsg && (
                    <p
                      className={errr ? " mt-3 error_pop" : "success_pop mt-3"}
                    >
                      {errorMsg}
                    </p>
                  )}
                  <Stepblock>
                    <div className="d-flex flex-column gap-5">
                      <Titletext>
                        investor presentation structure - expert advice videos
                      </Titletext>
                      <GalleryWrapper>
                        {allRecordVideo.map((video, index) => {
                          const videoPath = video.video.replace(/\\/g, "/");

                          return (
                            <VideoThumbnail
                              key={index}
                              onClick={() => openModal(video)}
                            >
                              <video
                                muted
                                onContextMenu={(e) => e.preventDefault()}
                                onError={(e) =>
                                  console.error("Error loading video:", e)
                                }
                              >
                                <source
                                  src={`${backendpath}/${videoPath}`}
                                  type="video/mp4"
                                />
                                <p>
                                  Your browser does not support the video tag or
                                  the video format.
                                </p>
                              </video>
                            </VideoThumbnail>
                          );
                        })}
                      </GalleryWrapper>
                    </div>
                  </Stepblock>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>

      <ModalOverlay open={isModalOpen}>
        <ModalContent>
          {selectedVideo && (
            <video
              ref={videoRef}
              className="advicevideo"
              controls
              autoPlay
              controlsList="nodownload nofullscreen noremoteplayback"
              onContextMenu={(e) => e.preventDefault()}
              style={{ width: "100%" }}
            >
              <source src={selectedVideo} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          )}
          <CloseButton onClick={closeModal}>&times;</CloseButton>
        </ModalContent>
      </ModalOverlay>
      <Wrapper>
        {showPopup && (
          <Overlay>
            <Popup>
              <CloseBtn onClick={() => setShowPopup(false)}>×</CloseBtn>
              <TitlePay className="pb-2">Payment Details</TitlePay>
              <CardImageContainer>
                <CardImage
                  src="/assets/user/images/cardimage.jpg"
                  alt="cards"
                />
              </CardImageContainer>
              <Form onSubmit={handleSubmit}>
                <FormGroup>
                  <Label>Name</Label>
                  <Input type="text" name="name" required placeholder="name" />
                </FormGroup>
                <FormGroup>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    name="email"
                    required
                    placeholder="email"
                  />
                </FormGroup>
                <FormGroup>
                  <Label>Card Number</Label>
                  <Input
                    type="text"
                    name="cardNumber"
                    required
                    placeholder="card number"
                    inputMode="numeric"
                    maxLength={19} // 16 digits + 3 spaces
                    onInput={(e) => {
                      let value = e.target.value.replace(/\D/g, ""); // Remove non-digits
                      value = value.substring(0, 16); // Max 16 digits
                      value = value.replace(/(.{4})/g, "$1 ").trim(); // Add space every 4 digits
                      e.target.value = value;
                    }}
                  />
                </FormGroup>

                <Row>
                  <FormGroup>
                    <Label>Expiry Date</Label>
                    <Input
                      type="text"
                      name="expiry"
                      required
                      placeholder="MM/YYYY"
                      inputMode="numeric"
                      maxLength={7}
                      pattern="(0[1-9]|1[0-2])\/\d{4}" // MM/YYYY format
                      onInput={(e) => {
                        let value = e.target.value.replace(/\D/g, ""); // remove non-digits
                        if (value.length > 6) value = value.slice(0, 6);
                        if (value.length >= 3) {
                          value = value.slice(0, 2) + "/" + value.slice(2);
                        }
                        e.target.value = value;
                      }}
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label>CVV</Label>
                    <Input type="text" name="cvv" required placeholder="123" />
                  </FormGroup>
                </Row>
                <ButtonGroup>
                  <Button
                    type="button"
                    className="cancel"
                    onClick={() => setShowPopup(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="submit">
                    Pay Now
                  </Button>
                </ButtonGroup>
              </Form>
            </Popup>
          </Overlay>
        )}
      </Wrapper>
      <PaymentPopupAcademy
        moduledata={moduledata}
        paytmmodule={getDataroompay}
        show={showPopupPay}
        onClose={() => setShowPopupPay(false)}
        onSubmit={handleSubmitPay}
      />
    </>
  );
}
