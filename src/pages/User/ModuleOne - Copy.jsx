import React, { useState, useEffect, useRef } from "react";
import "react-datepicker/dist/react-datepicker.css";
import MainHeader from "../../components/Users/MainHeader";
import Alertpopup from "../../components/Alertpopup";
import Alertpopupsuccess from "../../components/Alertpopupsuccess";
import AlertpopupsuccessZoom from "../../components/AlertpopupsuccessZoom";
import AlertpopuperrorZoom from "../../components/AlertpopuperrorZoom";
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

import { useParams, useNavigate } from "react-router-dom";
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
  const fetchMeetings = async () => {
    try {
      const res = await axios.post(apiURL + "get_combined_zoom_meetings", {
        module_id: id,
        user_id: userLogin.id,
      });

      const rawMeetings = res.data.meetings;
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const allEvents = rawMeetings.map((m) =>
        convertToUserTime(m.originalMeeting, m.isRegistered, userTimeZone)
      );
      console.log(allEvents);
      const registeredEvents = allEvents.filter((m) => m.isRegistered);

      setAllEvents(allEvents);
      setRegisteredMeetings(registeredEvents);
    } catch (err) {
      console.error("Failed to fetch combined meetings", err);
    }
  };
  const convertToUserTime = (meeting, isRegistered, userTimeZone) => {
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
      zoom_link: meeting.zoom_link,
      isRegistered: isRegistered, // preserve flag
      allDay: false,
      start: localTime.toDate(),
      end: localTime.clone().add(30, "minutes").toDate(),
      title: `${localTime.format("hh:mm A")} ${meeting.topic}`,
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
      console.log(res.data.zoomMeetings);
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
    console.log(checkModulesub);
    if (checkModulesub === "") {
      setShowPopupPay(true);
      return;
    }
    const currentDate = new Date();

    if (event.time) {
      var isoDate = event.end;

      const dateOnly = moment(isoDate).format("YYYY-MM-DD");

      const t = event.time;
      const updatedTime = moment(t, "HH:mm").add(30, "minutes").format("HH:mm");
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

    // ✅ Prevent selection of past meetings
    const now = new Date();
    setJoinpopup(event);
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
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <MainHeader />
          {showIframe && iframeHtml && (
            <div
              dangerouslySetInnerHTML={{ __html: iframeHtml }}
              style={{ width: "100%", height: "80vh" }}
            />
          )}

          <SectionWrapper className="d-block py-5">
            <div className="container-fluid">
              <div className="row justify-content-center">
                <div className="col-md-3">
                  <ModuleSideNav
                    isCollapsed={isCollapsed}
                    setIsCollapsed={setIsCollapsed}
                  />
                </div>
                <div className="col-md-9">
                  <form action="">
                    <Stepblock id="step5">
                      <div className="d-flex flex-column gap-5">
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
                          <AlertpopuperrorZoom
                            onClose={() => seterrorData(null)}
                          >
                            <div className="alert alert-danger mt-3">
                              <h5>❌ Meeting Scheduling Failed!</h5>
                              <p>
                                There was an issue with your meeting schedule.
                                Please review the following details:
                              </p>
                              <ul>
                                <li>
                                  <strong>Topic:</strong> {errorData.topic} —{" "}
                                </li>
                                <li>
                                  <strong>DateTime:</strong>{" "}
                                  {moment(errorData.start).format(
                                    "DD MMM, hh:mm A"
                                  )}
                                </li>
                              </ul>
                              <p className="mt-2">
                                The selected meeting time may have already
                                passed or is invalid. Please choose a future
                                date and time, and try again.
                              </p>
                            </div>
                          </AlertpopuperrorZoom>
                        )}

                        {successData && (
                          <AlertpopupsuccessZoom
                            onClose={() => closemessage(null)}
                          >
                            <div className="alert alert-success mt-3">
                              <h5>✅ Registered Successfully!</h5>
                              <p>
                                Your scheduled Zoom meetings are listed below on
                                the calendar:
                              </p>
                              <ul>
                                {successData.map((meeting, i) => (
                                  <li key={i}>
                                    <div>
                                      <strong>Topic:</strong> {meeting.title}
                                    </div>
                                    <div>
                                      <strong>DateTime:</strong>{" "}
                                      {moment(meeting.start).format(
                                        "DD MMM, hh:mm A"
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                              <p className="mt-2">
                                A <strong>"Join"</strong> button will appear 5
                                minutes before the session starts. You can use
                                it to join the Zoom meeting directly from here.
                              </p>
                            </div>
                          </AlertpopupsuccessZoom>
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

                        <Titletext>{moduledata.name}</Titletext>
                        <div className="row gy-3">
                          <div className="col-md-4">
                            <Dealcontent>
                              <div className="d-flex flex-column gap-3">
                                <div className="klogo">
                                  <div className="inlogo fulw">
                                    <img
                                      src="/logos/logoblack.png"
                                      alt="logo"
                                    />
                                  </div>
                                </div>
                                <h3>Keiretsu Forum Conoda</h3>
                                <h4>Deal Screening - 30 minutes</h4>
                              </div>
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
                            </Dealcontent>
                          </div>
                          <div className="col-md-8">
                            <div className="d-flex flex-column gap-2">
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
              </div>
            </div>
          </SectionWrapper>
        </div>

        <Overlay show={showPopup}>
          <PopupBox>
            <CloseBtn onClick={() => setShowPopup(false)}>×</CloseBtn>
            <div className="card p-3 mt-3">
              <h5 className="mb-2">Register Your Email</h5>
              <input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="form-control mb-2"
              />
              <input
                placeholder="Email"
                value={form.email}
                onChange={(e) =>
                  setForm({
                    ...form,
                    email: e.target.value,
                  })
                }
                className="form-control mb-2"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
              >
                Confirm Registration
              </button>
            </div>
          </PopupBox>
        </Overlay>
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
