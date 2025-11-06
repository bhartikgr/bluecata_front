import React, { useState, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import MainHeader from "../../components/Users/MainHeader";
import Alertpopup from "../../components/Alertpopup";
import Alertpopupsuccess from "../../components/Alertpopupsuccess";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Stepblock,
  Titletext,
  Iconblock,
  Dealcontent,
  SectionWrapper,
  Overlay,
  PopupBox,
  CloseBtn,
  Input,
  SubmitBtn,
  Wrapper,
  DatePickerWrapper,
  StyledIcon,
} from "../../components/Styles/RegisterStyles";
import { Link, useParams, useNavigate } from "react-router-dom";
import moment from "moment";
import { Building, Clock, Video, Earth } from "lucide-react";
import { Calendar, momentLocalizer, Navigate } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, toZonedTime } from "date-fns-tz";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import axios from "axios";
export default function Home() {
  const navigate = useNavigate();
  const [showPopup, setShowPopup] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "" });
  const localizer = momentLocalizer(moment);
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [ClientIP, setClientIP] = useState("");
  const [message, setMessage] = useState("");
  const [errorMsg, seterrorMsg] = useState("");
  const [successMsg, setsuccessMsg] = useState("");
  const [selectedTime, setSelectedTime] = useState(null);
  const [SelectedTimehours, setSelectedTimehours] = useState("");
  const [disabledButton, setdisabledButton] = useState(true);
  const [currentTime, setCurrentTime] = useState("");
  const [moduledata, setmoduledata] = useState("");
  const [loader, setloader] = useState("");
  const { id } = useParams();
  const [Descriptionvalue, setDescriptionvalue] = useState("");
  const apiURL = "http://localhost:5000/api/user/";
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };
  useEffect(() => {
    // Get supported time zones dynamically
    if (Intl.supportedValuesOf) {
      const zones = Intl.supportedValuesOf("timeZone");
      setTimeZones(zones);
    }
  }, []);
  useEffect(() => {
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
          setmoduledata(res.data.results[0]);
        } else {
          //  navigate("/dashboard");
        }
      } catch (err) { }
    };
    getmoduledata();
  }, [id]);
  useEffect(() => {
    document.title = "Module Page";
  }, []);
  const handleSelectSlot = async ({ start, end }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // midnight today
    const slotDate = new Date(start);
    slotDate.setHours(0, 0, 0, 0); // compare by date only

    // Check if selected date is in the past
    if (slotDate < today) {
      seterrorMsg("You cannot select a past date.");
      return; // ⛔ block past date selection
    }

    // Check if the selected date already exists in selectedSlots
    const isDateAlreadySelected = selectedSlots.some(
      (slot) => new Date(slot.start).setHours(0, 0, 0) === slotDate.getTime()
    );

    if (isDateAlreadySelected) {
      seterrorMsg("You cannot select the same date multiple times.");
      return; // ⛔ block selecting the same date multiple times
    }

    // Check if user has already selected 3 slots
    if (selectedSlots.length >= 3) {
      seterrorMsg("You can only select up to 3 meetings.");
      return;
    }

    // Enable button and update selected slots
    setdisabledButton(false);
    const newSlot = { start, end };
    const updatedSlots = [...selectedSlots, newSlot];
    setSelectedSlots(updatedSlots);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    let formdata = {
      name: e.target.name.value,
      email: e.target.email.value,
      timeset: SelectedTimehours,
      module_id: id,
      ip_address: ClientIP,
      selectedZone: selectedZone,
      selectedSlots: selectedSlots,
      description: Descriptionvalue,
    };

    setloader(true);
    try {
      const res = await axios.post(apiURL + "registerforZoom", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setloader(false);
      var checkdata = res.data;
      if (checkdata.status === "2") {
        setsuccessMsg("");
        seterrorMsg(checkdata.message);
        return;
      }
      if (checkdata.status === "1") {
        seterrorMsg("");
        setsuccessMsg(checkdata.message);
        setShowPopup(false);
        setTimeout(() => {
          window.location.reload();
        }, 3000);
        return;
      }
    } catch (err) { }
    console.log("Form submitted", formdata);
    //setShowPopup(false);
  };
  const [timeZones, setTimeZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  useEffect(() => {
    // Get supported time zones dynamically
    if (Intl.supportedValuesOf) {
      const zones = Intl.supportedValuesOf("timeZone");
      setTimeZones(zones);
    }
  }, []);

  useEffect(() => {
    // Update time whenever selectedZone changes
    const updateTime = () => {
      const time = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: selectedZone,
      }).format(new Date());
      setCurrentTime(time);
    };

    updateTime(); // initial
    const interval = setInterval(updateTime, 60000); // update every minute

    return () => clearInterval(interval);
  }, [selectedZone]);
  const handleTimeChange = (time) => {
    const zonedTime = toZonedTime(time, selectedZone); // Convert to the selected time
    const timeOnly = format(time, "hh:mm a");
    setSelectedTimehours(timeOnly);
    setSelectedTime(zonedTime);
  };
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Set time to midnight for date-only comparison

  const dayPropGetter = (date) => {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);

    if (day < now) {
      return {
        style: {
          backgroundColor: "#e0e0e0", // Greyed out
          pointerEvents: "none", // Completely disables clicking/selecting
          opacity: 0.6,
          cursor: "none",
        },
      };
    }

    return {};
  };
  const handledescription = (e) => {
    setDescriptionvalue(e.target.value);
  };
  const [isCollapsed, setIsCollapsed] = useState(false);
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <MainHeader />

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
                        <Titletext> Meetings</Titletext>
                        <div className="row gy-3">
                          <div className="col-md-12 text-center"></div>
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
            <form onSubmit={handleSubmit}>
              <div className="d-flex flex-column gap-3">
                <h3 className="text-center">Register</h3>
                <div className="d-block">
                  <Input
                    type="text"
                    name="name"
                    placeholder="Your Name *"
                    value={formData.name}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="d-block">
                  <Input
                    type="email"
                    name="email"
                    placeholder="Your Email *"
                    value={formData.email}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="d-block">
                  <DatePicker
                    name="time"
                    selected={selectedTime}
                    onChange={handleTimeChange}
                    showTimeSelect
                    showTimeSelectOnly
                    timeIntervals={15}
                    dateFormat="h:mm aa"
                    placeholderText="Select Time *"
                  />
                </div>
                <div className="d-flex align-items-center justify-content-end gap-2">
                  {loader && (
                    <div
                      className="spinner-border text-danger"
                      role="status"
                      style={{ width: "1.5rem", height: "1.5rem" }}
                    >
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  )}
                  <SubmitBtn
                    type="submit"
                    style={{
                      width: "100%",
                      opacity: loader ? 0.5 : 1,
                      pointerEvents: loader ? "none" : "auto",
                    }}
                  >
                    Submit For Zoom
                  </SubmitBtn>
                </div>
              </div>
            </form>
          </PopupBox>
        </Overlay>
      </Wrapper>
    </>
  );
}
