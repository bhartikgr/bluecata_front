import React, { useState, useEffect, useRef } from "react";
import "react-datepicker/dist/react-datepicker.css";
import TopBar from "../../components/Users/TopBar";
import Alertpopup from "../../components/Alertpopup";
import Alertpopupsuccess from "../../components/Alertpopupsuccess";
import AlertpopupsuccessZoom from "../../components/AlertpopupsuccessZoom";
import "bootstrap/dist/css/bootstrap.min.css";
import moment from "moment-timezone";
import { FaEye, FaTrashAlt } from "react-icons/fa";
import {
  Stepblock,
  Titletext,
  Iconblock,
  Dealcontent,
  SectionWrapper,
  Overlay,
  PopupBox,
  CloseBtn,
  Wrapper,
  StyledIcon,
} from "../../components/Styles/RegisterStyles";
import PaymentPopupAcademy from "../../components/Users/PaymentPopupAcademy"; // Adjust path

import { useParams, useNavigate, Link } from "react-router-dom";
import DangerAlertPopup from "../../components/Admin/DangerAlertPopup";
import { Building, Clock, Video, Earth } from "lucide-react";
import { Calendar, momentLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import axios from "axios";
export default function ModuleOne() {
  const navigate = useNavigate();
  const [timeZones, setTimeZones] = useState([]);
  const [TimeZonesWithTime, setTimeZonesWithTime] = useState([]);
  const [selectedZone, setSelectedZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [meetdata, setmeetdata] = useState(null);
  const [Joinpopup, setJoinpopup] = useState(null);
  const [JoinLiveBroadcastepopup, setJoinLiveBroadcastepopup] = useState(null);
  const [errr, seterrr] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [showPopupPay, setShowPopupPay] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "" });
  const localizer = momentLocalizer(moment);
  const [ClientIP, setClientIP] = useState("");
  const [zoomData, setzoomData] = useState([]);
  const [errorMsg, seterrorMsg] = useState("");
  const [successMsg, setsuccessMsg] = useState("");
  const [moduledata, setmoduledata] = useState("");
  const [checkModulesub, setcheckModulesub] = useState("");
  const { id } = useParams();
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [getDataroompay, setgetDataroompay] = useState("");
  const apiURL = "http://localhost:5000/api/user/";
  const apiUrlModule = "http://localhost:5000/api/admin/module/";
  const [errorData, seterrorData] = useState(null);
  const [successData, setSuccessData] = useState(null);
  const [viewMeetData, setviewMeetData] = useState(null);
  const [selectedMeetings, setSelectedMeetings] = useState([]);
  const [form, setForm] = useState({ name: "", email: "" });
  const [allEvents, setAllEvents] = useState([]);
  document.title = "Module Page";
  useEffect(() => {
    // Get supported time zones dynamically
    if (Intl.supportedValuesOf) {
      const zones = Intl.supportedValuesOf("timeZone");
      setTimeZones(zones);
    }
  }, []);
  const [registeredMeetings, setRegisteredMeetings] = useState([]);

  useEffect(() => {
    fetchMeetings();
  }, [id]);
  useEffect(() => {
    fetchSessionMeetings();
  }, [id]);
  // const fetchMeetings = async () => {
  //   try {
  //     const res = await axios.post(apiURL + "get_combined_zoom_meetings", {
  //       module_id: id,
  //       user_id: userLogin.id,
  //     });

  //     const rawMeetings = res.data.meetings;
  //     const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  //     const allEvents = rawMeetings.map((m) =>
  //       convertToUserTime(m.originalMeeting, m.isRegistered, userTimeZone)
  //     );
  //     const registeredEvents = allEvents.filter((m) => m.isRegistered);

  //     setAllEvents(allEvents);
  //     setRegisteredMeetings(registeredEvents);
  //   } catch (err) {
  //     console.error("Failed to fetch combined meetings", err);
  //   }
  // };
  const fetchMeetings = async () => {
    try {
      const [zoomRes, sessionRes] = await Promise.all([
        axios.post(apiURL + "get_combined_zoom_meetings", {
          module_id: id,
          user_id: userLogin.id,
        }),
        axios.post(apiURL + "get_SessionMeeting", {
          module_id: id,
          user_id: userLogin.id,
        }),
      ]);

      // Raw meetings from both responses
      const zoomMeetings = zoomRes.data.meetings || [];
      const sessionMeetings = sessionRes.data.meetings || [];

      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Convert Zoom meetings if needed (you already have a convert function)
      const convertedZoomMeetings = zoomMeetings.map((m) =>
        convertToUserTime(
          m.originalMeeting,
          m.isRegistered,
          userTimeZone,
          m.meet_type,
          m.zoom_link,
          m.morevng
        )
      );

      // Convert Session meetings similarly (they don't have isRegistered flag)
      // If sessionMeetings already are formatted, just map or pass directly
      const convertedSessionMeetings = sessionMeetings.map((m) => {
        // If `m.originalMeeting` exists, you can use convertToUserTime, else manual
        if (m.originalMeeting) {
          return convertToUserTime(
            m.originalMeeting,
            false,
            userTimeZone,
            m.meet_type,
            m.zoom_link,
            m.morevng
          );
        }
        // Or just return as is if already formatted correctly
        return {
          ...m,
          start: moment
            .tz(
              `${m.meeting_date} ${m.time}`,
              "YYYY-MM-DD HH:mm:ss",
              m.timezone
            )
            .tz(userTimeZone)
            .toDate(),
          end: moment
            .tz(
              `${m.meeting_date} ${m.time}`,
              "YYYY-MM-DD HH:mm:ss",
              m.timezone
            )
            .tz(userTimeZone)
            .add(30, "minutes")
            .toDate(),
          isRegistered: false,
        };
      });

      // Merge both arrays
      const allEvents = [...convertedZoomMeetings, ...convertedSessionMeetings];

      // Optionally sort all events by start date/time
      allEvents.sort((a, b) => a.start - b.start);

      // You can also filter or separate registered meetings if you want
      const registeredEvents = allEvents.filter((m) => m.isRegistered);

      setAllEvents(allEvents);
      setRegisteredMeetings(registeredEvents);
    } catch (err) {
      console.error("Failed to fetch meetings", err);
    }
  };

  const fetchSessionMeetings = async () => {
    try {
      const res = await axios.post(apiURL + "get_SessionMeeting", {
        module_id: id,
        user_id: userLogin.id,
      });
    } catch (err) {
      console.error("Failed to fetch combined meetings", err);
    }
  };
  const convertToUserTime = (
    meeting,
    isRegistered,
    userTimeZone,
    meet_type,
    zoomlink,
    morevng
  ) => {
    const dateFormatted = moment(meeting.meeting_date).format("YYYY-MM-DD");
    const fullDateTimeStr = `${dateFormatted} ${meeting.time}:00`;

    const originalTime = moment.tz(
      fullDateTimeStr,
      "YYYY-MM-DD HH:mm:ss",
      meeting.timezone
    );

    const localTime = originalTime.clone().tz(userTimeZone);

    return {
      id: meeting.id,
      topic: meeting.topic,
      time: meeting.time,
      datee: meeting.meeting_date_time,
      moduleId: meeting.module_id,
      zoom_link: zoomlink,
      isRegistered: isRegistered, // preserve flag
      allDay: false,
      start: localTime.toDate(),
      end: localTime.clone().add(30, "minutes").toDate(),
      title: `${localTime.format("hh:mm A")} ${meeting.topic}`,
      meet_type: meet_type,
      morevng: morevng,
    };
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
  const checkemail = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(
        apiURL + "sendAlluserReminderZoomLink",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.row;
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
  useEffect(() => {
    if (id !== "undefined") {
      checkmodulesubscription();
    }
  }, [id]);
  const checkmodulesubscription = async () => {
    let formdata = {
      id: id,
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURL + "checkmodulesubscription",
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
    if (id) {
      getmoduledata();
    }
  }, [id]);
  const getmoduledata = async () => {
    let formdata = {
      id: id,
    };
    try {
      const res = await axios.post(apiURL + "selectModule", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (res.data.results.length > 0) {
        checkmodulesubscription();
        setmoduledata(res.data.results[0]);

        setzoomData(res.data.zoomMeetings);
      } else {
        navigate("/dataroom-Duediligence");
      }
    } catch (err) { }
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
    // Get supported time zones dynamically
    if (Intl.supportedValuesOf) {
      const zones = Intl.supportedValuesOf("timeZone");
      setTimeZones(zones);
    }
  }, []);
  //With Time
  useEffect(() => {
    if (Intl.supportedValuesOf) {
      const zones = Intl.supportedValuesOf("timeZone");

      const now = moment(); // Current time

      const convertedZones = zones.map((tz) => ({
        value: tz,
        label: `${tz} (${now.clone().tz(tz).format("hh:mm A")})`, // current time in tz
      }));

      setTimeZonesWithTime(convertedZones);
    }
  }, []);

  const now = new Date();
  now.setHours(0, 0, 0, 0); // Set time to midnight for date-only comparison

  const handleSubmitPay = async (e) => {
    e.preventDefault();
    // handle form submission
    var vl = e.target;
    let formData = {
      name: vl.name.value,
      email: vl.email.value,
      cardnumber: vl.cardnumber.value,
      expiry: vl.expiry.value,
      cvv: vl.cvv.value,
      user_id: userLogin.id,
      plan_id: id,
    };
    try {
      const res = await axios.post(apiURL + "usersubscription", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
    setShowPopup(false);
  };
  //Zoom data

  const today = moment().format("YYYY-MM-DD");
  const [convertedTimeZones, setConvertedTimeZones] = useState([]);
  const prevMeetingRef = useRef(null); // track previous meeting

  useEffect(() => {
    if (zoomData?.length && timeZones?.length) {
      const today = moment().format("YYYY-MM-DD");

      const todayMeeting = zoomData.find(
        (meeting) => moment(meeting.start).format("YYYY-MM-DD") === today
      );

      if (todayMeeting) {
        // Reset previous ref on module change
        const currentKey = `${id}_${todayMeeting.id}_${moment(
          todayMeeting.start
        ).format()}`;

        if (prevMeetingRef.current === currentKey) {
          return; // No change, skip update
        }

        prevMeetingRef.current = currentKey;

        const originalMoment = moment(todayMeeting.start);

        const convertedZones = timeZones.map((tz) => ({
          value: tz,
          label: `${tz} (${originalMoment.clone().tz(tz).format("hh:mm A")})`,
        }));

        setConvertedTimeZones(convertedZones);
      }
    } else {
      setConvertedTimeZones(TimeZonesWithTime); // clear when data is missing
    }
  }, [zoomData, timeZones, id, TimeZonesWithTime]);
  const handleSelectEvent = (event) => {
    if (checkModulesub === "") {
      setShowPopupPay(true);
      return;
    }
    if (event.meet_type === "Broadcaste") {
      setJoinLiveBroadcastepopup(event);
    } else {
      const currentDate = new Date();

      if (event.time) {
        var isoDate = event.end;

        const dateOnly = moment(isoDate).format("YYYY-MM-DD");

        const t = event.time;
        const updatedTime = moment(t, "HH:mm")
          .add(30, "minutes")
          .format("HH:mm");
        var actualdateTime = `${dateOnly}T${updatedTime}:00`;
        const actualDate = new Date(actualdateTime);
        //console.log(event);
        //console.log(dateOnly, actualdateTime);
        if (actualDate > currentDate) {
        } else {
          seterrorData(event);
          return;
        }
      }

      const isRegistered = registeredMeetings.some((m) => m.id === event.id);

      if (isRegistered) {
        setviewMeetData(event);
        return;
      }

      setJoinpopup(event);
    }
    setmeetdata(event);
  };
  const handleConfirm = () => {
    const event = meetdata;
    const isSelected = selectedMeetings.find((m) => m.id === event.id);
    if (isSelected) {
      setSelectedMeetings(selectedMeetings.filter((m) => m.id !== event.id));
    } else {
      if (selectedMeetings.length >= 3) {
        seterrorMsg("Only 3 meetings allowed.");
        setTimeout(() => seterrorMsg(""), 2000);
        return;
      }
      setSelectedMeetings([...selectedMeetings, event]);
    }
    setJoinpopup(null);
  };
  const handleSubmit = async () => {
    if (!form.name || !form.email) {
      seterrorMsg("Please enter your name and email.");
      setTimeout(() => {
        seterrorMsg("");
      }, 1200);
      return;
    }
    let formdata = {
      email: form.email,
      name: form.name,
      user_id: userLogin.id,
      timezone: selectedZone,
      selectedMeetings: selectedMeetings.map((m) => m.id),
      ip: ClientIP,
    };
    try {
      const res = await axios.post(apiURL + "register_zoom", formdata);
      console.log(res.data);
      if (res.data.status === "success") {
        setSuccessData(res.data.selectedMeetings);
        setSelectedMeetings([]);
        fetchMeetings();
        getmoduledata();
      } else {
        seterrorMsg(res.data.message);
        // alert(result.message);
      }
      setTimeout(() => {
        setShowPopup(false);
        setsuccessMsg("");
        seterrorMsg("");
      }, 1200);
    } catch (err) {
      console.error("Error creating zoom meet", err);
      //alert("Error creating zoom meeting.");
    }
  };
  const closemessage = () => {
    setSuccessData(null); // Clear success message

    setTimeout(() => {
      setShowPopup(false);
    }, 5);
  };
  const [ShowPopupp, setShowPopupp] = useState(true);
  useEffect(() => {
    if (selectedMeetings.length > 0 && !successData) {
      setShowPopupp(false);
    } else {
      setForm({ name: "", email: "" });
      setShowPopupp(true);
    }
  }, [selectedMeetings, successData]);
  const openregisterPopup = () => {
    setForm({ name: "", email: "" });
    if (selectedMeetings.length > 0 && !successData) {
      setShowPopup(true);
    } else {
      setShowPopup(false);
    }
  };

  // const allEvents = [...selectedSlots];
  //Open Zoom Link
  const [iframeHtml, setIframeHtml] = useState(null);
  const [showIframe, setShowIframe] = useState(false); // new flag

  const handleopenZoomLink = async (zoomid) => {
    let formdata = {
      id: zoomid,
      ip_address: ClientIP,
    };
    try {
      const res = await axios.post(apiURL + "openZoomLink", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (res.data.status === "2") {
        seterrorMsg(res.data.message);
      } else {
        setIframeHtml(res.data);
        setShowIframe(true);
        setTimeout(() => {
          setShowIframe(false);
        }, 1000);
      }
    } catch (err) { }
  };
  const handleLiveBroadCaste = (idd) => {
    console.log(idd);
  };
  const [isCollapsed, setIsCollapsed] = useState(false);
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          {showIframe && iframeHtml && (
            <div
              dangerouslySetInnerHTML={{ __html: iframeHtml }}
              style={{ width: "100%", height: "80vh" }}
            />
          )}
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
                  <form action="">
                    <Stepblock id="step5">
                      <div className="d-flex flex-column gap-4">
                        {Joinpopup && (
                          <DangerAlertPopup
                            message={
                              <div className="alert alert-warning mt-3">
                                <h5>📝 Confirm Meeting Registration</h5>
                                <p>
                                  You're about to register for the following
                                  Zoom meeting. Please review the details
                                  carefully before proceeding:
                                </p>
                                <ul>
                                  <li>
                                    <strong>Topic:</strong> {Joinpopup.topic}
                                  </li>
                                  <li>
                                    <strong>Date & Time:</strong>{" "}
                                    {moment(Joinpopup.start).format(
                                      "DD MMM, hh:mm A"
                                    )}
                                  </li>
                                </ul>
                                <p className="mt-3">
                                  👉 Once you confirm, the{" "}
                                  <strong>"Register For Zoom"</strong> button
                                  will be enabled.
                                </p>
                                <p className="mt-2">
                                  Do you want to continue with the registration?
                                </p>
                              </div>
                            }
                            onConfirm={handleConfirm} // Proceed with registration
                            onCancel={() => setJoinpopup(null)} // Cancel registration
                          />
                        )}

                        {errorMsg && (
                          <Alertpopup
                            message={errorMsg}
                            onClose={() => seterrorMsg("")}
                          />
                        )}

                        {successMsg && (
                          <Alertpopupsuccess
                            message={successMsg}
                            onClose={() => setsuccessMsg("")}
                          />
                        )}
                        {errorData && (
                          <>
                            {/* Backdrop */}
                            <div
                              className="modal-backdrop fade show"
                              style={{
                                backgroundColor: "rgba(0, 0, 0, 0.5)",
                                zIndex: 1050,
                              }}
                            ></div>

                            {/* Modal */}
                            <div
                              className="modal fade show d-block"
                              tabIndex="-1"
                              role="dialog"
                              style={{ zIndex: 1100 }}
                            >
                              <div className="modal-dialog modal-dialog-centered">
                                <div
                                  className="modal-content"
                                  style={{
                                    borderRadius: "12px",
                                    overflow: "hidden",
                                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
                                    border: "none",
                                  }}
                                >
                                  {/* Header */}
                                  <div
                                    className="modal-header"
                                    style={{
                                      backgroundColor: "#dc3545",
                                      color: "white",
                                      borderBottom: "none",
                                      padding: "1.25rem 1.5rem",
                                    }}
                                  >
                                    <h5 className="modal-title fw-semibold m-0">
                                      Meeting Scheduling Failed
                                    </h5>
                                    <button
                                      type="button"
                                      className="btn-close btn-close-white"
                                      onClick={() => seterrorData(null)}
                                    ></button>
                                  </div>

                                  {/* Body */}
                                  <div className="modal-body p-4">
                                    <p className="text-dark mb-3 fw-medium">
                                      There was an issue with your meeting
                                      schedule. Please review the details below:
                                    </p>

                                    {/* Meeting Details */}
                                    <div
                                      className="card border-0 bg-light mb-3"
                                      style={{ borderRadius: "8px" }}
                                    >
                                      <div className="card-body p-3">
                                        <h6 className="fw-semibold mb-2 text-dark">
                                          Meeting Details
                                        </h6>
                                        <div className="d-flex mb-2">
                                          <span className="text-muted me-2">
                                            Topic:
                                          </span>
                                          <span className="fw-medium text-dark">
                                            {errorData.topic}
                                          </span>
                                        </div>
                                        <div className="d-flex">
                                          <span className="text-muted me-2">
                                            Time:
                                          </span>
                                          <span className="fw-medium text-dark">
                                            {moment(errorData.start).format(
                                              "DD MMM, YYYY"
                                            )}{" "}
                                            at{" "}
                                            {moment(errorData.start).format(
                                              "hh:mm A"
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Warning */}
                                    <div
                                      className="alert alert-warning border-0"
                                      style={{
                                        backgroundColor: "rgba(255,193,7,0.1)",
                                        borderRadius: "8px",
                                        borderLeft: "4px solid #ffc107",
                                      }}
                                    >
                                      <p className="mb-0 fw-medium text-dark">
                                        The selected meeting time may have
                                        already passed or is invalid. Please
                                        choose a future date and time, and try
                                        again.
                                      </p>
                                    </div>
                                  </div>

                                  {/* Footer */}
                                  <div
                                    className="modal-footer"
                                    style={{
                                      borderTop: "1px solid #e9ecef",
                                      padding: "1rem 1.5rem",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      onClick={() => seterrorData(null)}
                                      style={{
                                        borderRadius: "8px",
                                        padding: "0.625rem 1.5rem",
                                        fontWeight: "500",
                                      }}
                                    >
                                      OK, I Understand
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        {successData && (
                          <div
                            className="modal-backdrop fade show"
                            style={{
                              display: "block",
                              backgroundColor: "rgba(0, 0, 0, 0.5)",
                            }}
                          >
                            <div
                              className="modal fade show d-block"
                              tabIndex="-1"
                            >
                              <div className="modal-dialog modal-dialog-centered modal-lg">
                                <div
                                  className="modal-content"
                                  style={{
                                    borderRadius: "12px",
                                    overflow: "hidden",
                                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
                                    border: "none",
                                  }}
                                >
                                  {/* Modal Header */}
                                  <div
                                    className="modal-header"
                                    style={{
                                      backgroundColor: "#198754",
                                      color: "white",
                                      borderBottom: "none",
                                      padding: "1.25rem 1.5rem",
                                    }}
                                  >
                                    <div className="d-flex align-items-center">
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="24"
                                        height="24"
                                        fill="currentColor"
                                        className="me-2"
                                        viewBox="0 0 16 16"
                                      >
                                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z" />
                                      </svg>
                                      <h5 className="modal-title mb-0 fw-semibold">
                                        Registered Successfully!
                                      </h5>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn-close btn-close-white"
                                      onClick={() => closemessage(null)}
                                      style={{
                                        filter: "brightness(0) invert(1)",
                                      }}
                                    ></button>
                                  </div>

                                  {/* Modal Body */}
                                  <div className="modal-body p-4">
                                    <div className="mb-4">
                                      <p
                                        className="text-dark mb-4"
                                        style={{
                                          fontSize: "1rem",
                                          lineHeight: "1.5",
                                        }}
                                      >
                                        Your scheduled Zoom meetings are listed
                                        below. A <strong>"Join"</strong> button
                                        will appear 5 minutes before each
                                        session starts.
                                      </p>

                                      <div
                                        className="card border-0"
                                        style={{
                                          backgroundColor: "#f8f9fa",
                                          borderRadius: "8px",
                                        }}
                                      >
                                        <div className="card-body p-3">
                                          <h6
                                            className="fw-semibold mb-3 text-dark"
                                            style={{ fontSize: "1rem" }}
                                          >
                                            Meeting Details:
                                          </h6>

                                          <div className="row g-3">
                                            {successData.map((meeting, i) => (
                                              <div key={i} className="col-12">
                                                <div
                                                  className="d-flex align-items-start p-3 rounded"
                                                  style={{
                                                    backgroundColor: "white",
                                                  }}
                                                >
                                                  <div className="bg-success bg-opacity-10 p-2 rounded-circle me-3 flex-shrink-0">
                                                    <svg
                                                      xmlns="http://www.w3.org/2000/svg"
                                                      width="16"
                                                      height="16"
                                                      fill="currentColor"
                                                      className="text-success"
                                                      viewBox="0 0 16 16"
                                                    >
                                                      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
                                                    </svg>
                                                  </div>
                                                  <div className="flex-grow-1">
                                                    <div className="d-flex justify-content-between align-items-start flex-wrap">
                                                      <div className="me-3 mb-1">
                                                        <span className="text-muted d-block small">
                                                          Topic:
                                                        </span>
                                                        <span className="fw-medium text-dark">
                                                          {meeting.title}
                                                        </span>
                                                      </div>
                                                      <div className="text-end">
                                                        <span className="text-muted d-block small">
                                                          Date & Time:
                                                        </span>
                                                        <span className="fw-medium text-dark">
                                                          {moment(
                                                            meeting.start
                                                          ).format(
                                                            "DD MMM, hh:mm A"
                                                          )}
                                                        </span>
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div
                                      className="alert alert-info border-0 d-flex align-items-center"
                                      style={{
                                        backgroundColor:
                                          "rgba(13, 110, 253, 0.1)",
                                        borderRadius: "8px",
                                        borderLeft: "4px solid #0d6efd",
                                      }}
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="20"
                                        height="20"
                                        fill="currentColor"
                                        className="text-info me-3 flex-shrink-0"
                                        viewBox="0 0 16 16"
                                      >
                                        <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
                                      </svg>
                                      <div>
                                        <p className="mb-0 fw-medium text-dark">
                                          A <strong>"Join"</strong> button will
                                          appear 5 minutes before each session
                                          starts. You can use it to join the
                                          Zoom meeting directly from here.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Modal Footer */}
                                  <div
                                    className="modal-footer"
                                    style={{
                                      borderTop: "1px solid #e9ecef",
                                      padding: "1rem 1.5rem",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="btn btn-success"
                                      onClick={() => closemessage(null)}
                                      style={{
                                        borderRadius: "8px",
                                        padding: "0.625rem 1.5rem",
                                        fontWeight: "500",
                                      }}
                                    >
                                      Got It, Thanks!
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {viewMeetData && (
                          <AlertpopupsuccessZoom
                            onClose={() => setviewMeetData(null)}
                          >
                            <div className="alert alert-info mt-3">
                              <h5>📅 Zoom Meeting Details</h5>
                              <p>
                                The following Zoom meeting is scheduled. Please
                                find the details below:
                              </p>
                              <ul>
                                <li>
                                  <strong>Topic:</strong> {viewMeetData.topic}{" "}
                                </li>
                                <li>
                                  <strong>Date & Time:</strong>{" "}
                                  {moment(viewMeetData.start).format(
                                    "DD MMM, hh:mm A"
                                  )}
                                </li>
                              </ul>
                              <p className="mt-2">
                                A <strong>Join</strong> button will appear 5
                                minutes before the session starts. You can use
                                it to join the Zoom meeting directly from here.
                              </p>
                              {moment().isSameOrAfter(
                                moment(viewMeetData.start).subtract(
                                  5,
                                  "minutes"
                                )
                              ) &&
                                moment().isBefore(
                                  moment(viewMeetData.start).add(45, "hour")
                                ) && (
                                  <button
                                    onClick={() =>
                                      handleopenZoomLink(viewMeetData.id)
                                    }
                                    type="button"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary mt-3"
                                  >
                                    Join Zoom Meeting
                                  </button>
                                )}
                            </div>
                          </AlertpopupsuccessZoom>
                        )}
                        {JoinLiveBroadcastepopup && (
                          <>
                            {/* Backdrop */}
                            <div
                              className="modal-backdrop fade show"
                              style={{
                                backgroundColor: "rgba(0, 0, 0, 0.5)",
                                zIndex: 1050,
                              }}
                            ></div>

                            {/* Modal */}
                            <div
                              className="modal fade show d-block"
                              tabIndex="-1"
                              role="dialog"
                              style={{ zIndex: 1100 }}
                            >
                              <div className="modal-dialog modal-dialog-centered">
                                <div
                                  className="modal-content"
                                  style={{
                                    borderRadius: "12px",
                                    overflow: "hidden",
                                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
                                    border: "none",
                                  }}
                                >
                                  {/* Header */}
                                  <div
                                    className="modal-header"
                                    style={{
                                      backgroundColor: "#335795",
                                      color: "white",
                                      borderBottom: "none",
                                      padding: "1.25rem 1.5rem",
                                    }}
                                  >
                                    <h5 className="modal-title fw-semibold m-0">
                                      Broadcast Session Details
                                    </h5>
                                    <button
                                      type="button"
                                      className="btn-close btn-close-white"
                                      onClick={() =>
                                        setJoinLiveBroadcastepopup(null)
                                      }
                                    ></button>
                                  </div>

                                  {/* Body */}
                                  <div className="modal-body p-4">
                                    <p className="text-dark mb-3 fw-medium">
                                      A broadcast session is scheduled. Please
                                      find the details below:
                                    </p>

                                    {/* Session Details Card */}
                                    <div
                                      className="card border-0 bg-light mb-3"
                                      style={{ borderRadius: "8px" }}
                                    >
                                      <div className="card-body p-3">
                                        <h6 className="fw-semibold mb-2 text-dark">
                                          Session Details
                                        </h6>

                                        <div className="d-flex mb-2">
                                          <span className="text-muted me-2">
                                            Session Period:
                                          </span>
                                          <span className="fw-medium text-dark">
                                            {JoinLiveBroadcastepopup.morevng}
                                          </span>
                                        </div>

                                        <div className="d-flex mb-2">
                                          <span className="text-muted me-2">
                                            Topic:
                                          </span>
                                          <span className="fw-medium text-dark">
                                            {JoinLiveBroadcastepopup.topic}
                                          </span>
                                        </div>

                                        <div className="d-flex">
                                          <span className="text-muted me-2">
                                            Date & Time:
                                          </span>
                                          <span className="fw-medium text-dark">
                                            {moment(
                                              JoinLiveBroadcastepopup.start
                                            ).format("DD MMM, YYYY")}{" "}
                                            at{" "}
                                            {moment(
                                              JoinLiveBroadcastepopup.start
                                            ).format("hh:mm A")}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Info Note */}
                                    <div
                                      className="alert alert-info border-0"
                                      style={{
                                        backgroundColor: "rgba(51,87,149,0.1)",
                                        borderRadius: "8px",
                                        borderLeft: "4px solid #335795",
                                        color: "#212529",
                                      }}
                                    >
                                      <p className="mb-0 fw-medium">
                                        A <strong>"Join"</strong> button will
                                        appear 5 minutes before the session
                                        starts.
                                      </p>
                                    </div>

                                    {/* Join Button */}
                                    {moment().isSameOrAfter(
                                      moment(
                                        JoinLiveBroadcastepopup.start
                                      ).subtract(5, "minutes")
                                    ) &&
                                      moment().isBefore(
                                        moment(
                                          JoinLiveBroadcastepopup.start
                                        ).add(45, "minutes")
                                      ) && (
                                        <div className="text-center">
                                          <Link
                                            target="_blank"
                                            to={
                                              JoinLiveBroadcastepopup.zoom_link
                                            }
                                            rel="noopener noreferrer"
                                            className="btn px-4 py-2 fw-semibold"
                                            style={{
                                              borderRadius: "8px",
                                              backgroundColor: "#335795",
                                              border: "none",
                                              color: "white",
                                            }}
                                          >
                                            Join Live Broadcast Session
                                          </Link>
                                        </div>
                                      )}
                                  </div>

                                  {/* Footer */}
                                  <div
                                    className="modal-footer"
                                    style={{
                                      borderTop: "1px solid #e9ecef",
                                      padding: "1rem 1.5rem",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary"
                                      onClick={() =>
                                        setJoinLiveBroadcastepopup(null)
                                      }
                                      style={{
                                        borderRadius: "8px",
                                        padding: "0.625rem 1.5rem",
                                        fontWeight: "500",
                                      }}
                                    >
                                      Close
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        <Titletext>{moduledata.name}</Titletext>
                        <div className="row gy-3">
                          <div className="col-12">
                            <Dealcontent>
                              <div className="d-flex flex-column gap-3">
                                <div className="klogo">
                                  <div className="inlogo fulw">
                                    <img src="/logos/capavate.png" alt="logo" />
                                  </div>
                                </div>
                                <h3>Keiretsu Forum Conoda</h3>
                                <h4>Deal Screening - 30 minutes</h4>
                              </div>
                              <div className="d-flex flex-column gap-2 pt-2">
                                <h6>
                                  <StyledIcon>
                                    <Clock />
                                  </StyledIcon>
                                  30 min
                                </h6>
                                <h6>
                                  <StyledIcon>
                                    <Video />
                                  </StyledIcon>
                                  Web conferencing details provided upon
                                  confirmation.
                                </h6>

                                <div
                                  dangerouslySetInnerHTML={{
                                    __html: moduledata.description,
                                  }}
                                />
                              </div>
                            </Dealcontent>
                          </div>
                          <div className="col-12">
                            <div className="d-flex flex-column gap-3">
                              <label>Select a date and time</label>
                              <Iconblock>
                                <Calendar
                                  localizer={localizer}
                                  events={allEvents}
                                  startAccessor="start"
                                  endAccessor="end"
                                  style={{ height: 600 }}
                                  popup
                                  selectable
                                  defaultView="month"
                                  views={["month"]} // 👈 this hides all other view buttons
                                  onSelectEvent={handleSelectEvent}
                                  eventPropGetter={(event) => {
                                    const isRegistered =
                                      registeredMeetings.some(
                                        (m) => m.id === event.id
                                      );
                                    const isSelected = selectedMeetings.some(
                                      (m) => m.id === event.id
                                    );

                                    let className = "event-default";
                                    if (isRegistered)
                                      className = "event-registered";
                                    else if (isSelected)
                                      className = "event-selected";

                                    return { className };
                                  }}
                                />

                                <strong>Time Zone</strong>
                                <select
                                  value={selectedZone}
                                  onChange={(e) =>
                                    setSelectedZone(e.target.value)
                                  }
                                >
                                  {convertedTimeZones.map((tz) => (
                                    <option key={tz.value} value={tz.value}>
                                      {tz.label}
                                    </option>
                                  ))}
                                </select>
                              </Iconblock>

                              <button
                                style={{
                                  opacity: ShowPopupp ? 0.5 : 1,
                                  pointerEvents: ShowPopupp ? "none" : "auto",
                                }}
                                className="registerzoom"
                                onClick={() => openregisterPopup()}
                                type="button"
                              >
                                Register For Zoom
                              </button>
                            </div>
                          </div>
                          <div className="col-12">
                            <Iconblock>
                              <Building />
                              <p>{moduledata.textt}</p>
                            </Iconblock>
                          </div>
                        </div>
                      </div>
                    </Stepblock>
                  </form>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
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
