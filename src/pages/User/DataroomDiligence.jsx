import React, { useState, useEffect } from "react";

import TopBar from "../../components/Users/TopBar";
import ModuleSideNav from "../../components/Users/ModuleSideNav";

import { IoCloseCircleOutline } from "react-icons/io5";
import "bootstrap/dist/css/bootstrap.min.css";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import {
  DataRoomSection,
  TableHeader,
  TableData,
  UploadButton,
} from "../../components/Styles/DataRoomStyle.js";
import moment from "moment";
import { momentLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import axios from "axios";
import UploadModal from "../../components/Users/popup/UploadModal.jsx";
import LockFilePayment from "../../components/Users/popup/LockFilePayment.jsx";
import UploadModalUpdate from "../../components/Users/popup/UploadModalUpdate.jsx";
import AiSummaryForm from "../../components/Users/popup/AiSummaryForm.jsx";
import AiQuestionForm from "../../components/Users/popup/AiQuestionForm.jsx";
import { Button } from "../../components/Styles/MainStyle.js";
import DangerAlertPopup from "../../components/Admin/DangerAlertPopup";
import DangerAlertPopupMessage from "../../components/Admin/DangerAlertPopupMessage";
import { FaPlus } from "react-icons/fa6";
import { FaTimes } from "react-icons/fa";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import {
  Trash2,
  MoreHorizontal,
  Download,
  X,
  Lock,
  Unlock,
  Pencil,
  Brain,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import AirwallexPaymentPopupOneTimeDataroom from "../../components/Users/AirwallexPaymentPopupOneTimeDataroom.jsx";
import AirwallexPaymentPopupPerInstanceDataroom from "../../components/Users/AirwallexPaymentPopupPerInstanceDataroom.jsx";
export default function DataroomDiligence() {
  const [lockId, setlockId] = useState([]);
  const [dangerMessagealertLockUnlock, setdangerMessagealertLockUnlock] =
    useState("");
  const [dangerMessagealertAllLock, setdangerMessagealertAllLock] =
    useState("");

  const [errr, seterrr] = useState(false);
  const [normallyMessage, setnormallyMessage] = useState("");
  const localizer = momentLocalizer(moment);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModalOpenLockFile, setisModalOpenLockFile] = useState(false);
  const [isModalOpenUpdate, setIsModalOpenUpdate] = useState(false);
  const [categories, setCategories] = useState([]);
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const [spinnerss, setspinnerss] = useState(false);
  const [checkReferCodepay, setcheckReferCodepay] = useState(true);
  const userLogin = JSON.parse(storedUsername);
  var apiURL = "http://localhost:5000/api/user/";
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  document.title = "Dataroom Management & Executive Summary";
  const [err, seterr] = useState(false);

  const [paymentType, setpaymentType] = useState("Onetime");
  const [PayidOnetime, setPayidOnetime] = useState("");
  const [Documentcheck, setDocumentcheck] = useState(false);
  const [DataRoom_InvestReporint, setDataRoom_InvestReporint] = useState(false);
  const [companyData, setcompanyData] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [authorizedData, setAuthorizedData] = useState(null);
  const apiURLSignature = "http://localhost:5000/api/user/";

  useEffect(() => {
    getAuthorizedSignature();
  }, []);
  const getAuthorizedSignature = async () => {
    let formData = {
      company_id: userLogin.companies[0].id,
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURLSignature + "getAuthorizedSignature",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      const checkData = res.data.results;
      if (checkData.length > 0) {
        setAuthorizedData(checkData[0]);
      }
    } catch (err) { }
  };
  useEffect(() => {
    checkApprovaldoc();
  }, []);
  useEffect(() => {
    getcategories();
  }, []);
  useEffect(() => {
    getcompanyData();
  }, []);
  useEffect(() => {
    //checkmail();
  }, []);
  const checkApprovaldoc = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "checkApprovaldoc",
        formdata,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (res.data.status === "1" && res.data.unique_code != null) {
        var retcode = res.data.unique_code;
        navigate("/approvalpage/" + retcode);
      }
    } catch (err) { }
  };

  const getcompanyData = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(apiURLAiFile + "getcompanyData", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      if (res.data.results.length > 0) {
        setCompanyLogoUrl(res.data.results[0].downloadUrl);
        setcompanyData(res.data.results[0]);
      }
    } catch (err) { }
  };
  useEffect(() => {
    getcheckDataRoomPlusInvestorSubscription();
  }, []);
  const getcheckDataRoomPlusInvestorSubscription = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "getcheckDataRoomPlusInvestorSubscription",
        formdata,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      console.log(res.data.results[0].active_until);
      if (res.data.results.length > 0) {
        const endDate = new Date(res.data.results[0].active_until);
        const today = new Date();

        // Set both dates to midnight to ignore time
        endDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        if (today <= endDate) {
          setDataRoom_InvestReporint(true);
        } else {
          setDataRoom_InvestReporint(false);
        }
      }
    } catch (err) { }
  };

  useEffect(() => {
    getDocumentcheck();
  }, []);

  const getDocumentcheck = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "getDocumentcheck",
        formdata,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (res.data.results.length > 0) {
        setDocumentcheck(true);
      } else {
        setDocumentcheck(false);
      }
    } catch (err) { }
  };
  const navigate = useNavigate();
  const getcategories = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(apiURL + "getcategories", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setCategories(res.data.results);
    } catch (err) { }
  };

  //Payments one time
  const apiUrlModule = "http://localhost:5000/api/admin/module/";

  const [dangerMessage, setdangerMessage] = useState("");
  const [dangerMessagealert, setdangerMessagealert] = useState("");
  const [dangerMessagealertDoc, setdangerMessagealertDoc] = useState("");
  const [getDataroompay, setgetDataroompay] = useState("");
  const [CheckOnetimePay, setCheckOnetimePay] = useState(false);
  useEffect(() => {
    getDataroompayment();
    getCheckOnetimePayment();
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

      setgetDataroompay(respo[0]);
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
  const CheckoutForm = ({ payment, referstatus }) => {
    const [mainamount, setmainamount] = useState(payment);
    const [refers, setrefers] = useState(referstatus);
    const stripe = useStripe();
    const [discount, setdiscount] = useState("");
    const [referalCode, setreferalCode] = useState("");
    const elements = useElements();
    const [buttonPay, setbuttonPay] = useState("");
    const [spinners, setspinners] = useState(false);
    const [message, setMessage] = useState("");
    const [err, seterr] = useState(false);
    const [ClientIP, setClientIP] = useState("");
    setTimeout(() => {
      setMessage("");
    }, 5000);
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

      if (!stripe || !elements) return;

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        setMessage("Payment form is not ready. Please reload the page.");
        seterr(true);
        return;
      }
      // 🔹 Validate Card Element fields
      const { error: cardError } = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
      });

      if (cardError) {
        setMessage(cardError.message || "Invalid card details.");
        seterr(true);
        return;
      }
      setspinners(true);

      try {
        // Get clientSecret from backend
        const { data } = await axios.post(
          `${apiURLAiFile}CreateuserSubscriptionDataRoomCheck`,
          {
            company_id: userLogin.companies[0].id,
            amount: mainamount, // in EUR
          }
        );

        // Handle free subscription (clientSecret is null)
        if (!data.clientSecret) {
          setMessage(
            data.message || "Free subscription applied, no payment required"
          );
          seterr(false);
          setspinners(false);

          const formdata = {
            code: referalCode,
            company_id: userLogin.companies[0].id,
            created_by_id: userLogin.id,
            amount: mainamount,
            clientSecret: null,
            PayidOnetime: PayidOnetime,
            payment_status: "free",
            discount: data.percentage,
            ip_address: ClientIP,
          };

          if (paymentType === "Perinstance") {
            await paymentsuccessPerinstnace(formdata);
          } else {
            await paymentsuccess(formdata);
          }

          return; // Skip Stripe call
        }

        // Paid subscription flow
        const result = await stripe.confirmCardPayment(data.clientSecret, {
          payment_method: {
            card: cardElement,
          },
        });

        if (result.error) {
          setMessage(result.error.message);
          seterr(true);
          setspinners(false);
        } else if (result.paymentIntent.status === "succeeded") {
          const formdata = {
            code: referalCode,
            company_id: userLogin.companies[0].id,
            created_by_id: userLogin.id,
            amount: mainamount,
            clientSecret: data.clientSecret,
            PayidOnetime: PayidOnetime,
            payment_status: result.paymentIntent.status,
            discount: data.percentage,
            ip_address: ClientIP,
          };
          if (paymentType === "Perinstance") {
            await paymentsuccessPerinstnace(formdata);
          } else {
            await paymentsuccess(formdata);
          }
        } else {
          setMessage("Payment failed. Try again.");
          seterr(true);
          setspinners(false);
        }
      } catch (error) {
        setMessage("Unexpected error occurred.");
        seterr(true);
        setspinners(false);
      }
    };
    const handleRefferalCode = async (e) => {
      const upperValue = e.target.value.toUpperCase();

      setreferalCode(upperValue);
    };
    const handleapplycode = async () => {
      if (referalCode === "") {
        setbuttonPay("Enter the code");
      } else {
        let refercode = {
          code: referalCode,
          type: "Dataroom_Plus_Investor_Report",
          company_id: userLogin.companies[0].id,
        };
        try {
          const resp = await axios.post(
            `${apiURLAiFile}checkreferCode`,
            refercode,
            {
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
            }
          );
          if (resp.data.results.length > 0) {
            var data = resp.data.results[0];

            if (data.usage_limit > data.used_count) {
              setdiscount(data.percentage);
              const discountValue =
                (getDataroompay.onetime_Fee * data.percentage) / 100;

              const final = getDataroompay.onetime_Fee - discountValue;
              setmainamount(final);
              setbuttonPay("");
            } else {
              setdiscount("");
              setmainamount(getDataroompay.onetime_Fee);
              setbuttonPay("This code already used");
            }
          } else {
            setdiscount("");
            setmainamount(getDataroompay.onetime_Fee);
            setbuttonPay("Invalid code!");
          }
        } catch (err) {
        } finally {
        }
      }
    };
    const paymentsuccess = async (formdata) => {
      try {
        await axios.post(
          `${apiURLAiFile}CreateuserSubscriptionDataRoom`,
          formdata,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        setMessage("Payment successful! 🎉");
        seterr(false);
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } catch (err) {
        console.error("Success handler error:", err);
        setMessage("Payment was captured, but post-process failed.");
        seterr(true);
      } finally {
        setspinners(false);
      }
    };
    const paymentsuccessPerinstnace = async (formdata) => {
      try {
        await axios.post(
          `${apiURLAiFile}CreateuserSubscriptionDataRoomPerinstance`,
          formdata,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        setMessage("Payment successful! 🎉");
        seterr(false);
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } catch (err) {
        console.error("Success handler error:", err);
        setMessage("Payment was captured, but post-process failed.");
        seterr(true);
      } finally {
        setspinners(false);
      }
    };

    return (
      <form onSubmit={handleSubmit}>
        <div
          className="form-control rounded-3"
          style={{
            padding: "0.75rem",
            border: "1px solid #000",
            borderColor: "#ced4da",
          }}
        >
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: "#32325d",
                  fontFamily:
                    '"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  "::placeholder": { color: "#a0aec0" },
                  padding: "0.75rem",
                },
                invalid: {
                  color: "#e5424d",
                },
              },
              classes: {
                base: "stripe-card-element",
                focus: "border-primary",
                invalid: "border-danger",
              },
            }}
          />
        </div>
        {referstatus && (
          <div className="d-flex gap-2 d-md-flex justify-content-md-end mt-4">
            <div className="d-flex flex-column">
              <input
                type="text"
                name="refferal_code"
                defaultValue={referalCode}
                onInput={handleRefferalCode}
                className="form-control w-auto"
                autoComplete="off"
                placeholder="Apply Coupon Code"
                style={{ textTransform: "uppercase" }}
              />
              {buttonPay && (
                <span
                  className="text-danger mt-1"
                  style={{ fontSize: "0.875rem" }}
                >
                  {buttonPay}
                </span>
              )}
            </div>

            <Button
              type="button"
              onClick={handleapplycode}
              className="submit d-flex align-items-center gap-2"
              style={{ background: "#5C636B", height: "fit-content" }}
            >
              Apply Coupon
            </Button>
          </div>
        )}
        {discount && (
          <div className="d-flex gap-2 d-md-flex justify-content-md-end mt-4">
            <b>Discount:</b> {discount}%
          </div>
        )}
        <div className="d-grid gap-2 d-md-flex justify-content-md-end mt-4">
          <Button
            disabled={!stripe || spinners}
            type="submit"
            className="submit d-flex align-items-center gap-2"
            style={{ background: "#003b21" }}
          >
            {!spinners && <span>Pay €{mainamount}</span>}
            {spinners && (
              <div
                className="spinner-border text-white spinneronetimepay m-0"
                role="status"
              >
                <span className="visually-hidden"></span>
              </div>
            )}
          </Button>
        </div>

        {message && (
          <div
            className={`flex items-center justify-between gap-3 shadow-lg ${err ? "error_pop" : "success_pop"
              }`}
          >
            <div className="d-flex align-items-start gap-2">
              <span className="d-block">{message}</span>
            </div>

            <button
              type="button"
              className="close_btnCros"
              onClick={() => setMessage("")}
            >
              ×
            </button>
          </div>
        )}
      </form>
    );
  };

  const [renew, setrenew] = useState(false);
  const getCheckOnetimePayment = async () => {
    let formData = {
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiUrlModule + "getCheckOnetimePayment",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      const respo = res.data.row;

      if (respo.length > 0) {
        const endDate = new Date(respo[0].end_date);
        const today = new Date();

        // Set both dates to midnight to ignore time
        endDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        if (today <= endDate) {
          setrenew(false);
          setCheckOnetimePay(true); // still active
        } else {
          setrenew(true);
          setCheckOnetimePay(false); // expired
        }
      } else {
        setrenew(false);
        setCheckOnetimePay(false);
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
  const [showPopup, setShowPopup] = useState(false);
  const [paynowOneTime, setpaynowOneTime] = useState(false);
  const [payinfo, setpayinfo] = useState(true);

  const [catgeoryId, setcatgeoryId] = useState("");
  const [subcatgeoryId, setsubcatgeoryId] = useState("");
  const [CategorynameFile, setCategorynameFile] = useState("");
  const handleUploadDocument = async (cat_id, sub_id, aiadd = "") => {
    //Check Both Payment
    getcheckDataRoomPlusInvestorSubscription();
    //Check Both Payment
    //setmainamount(getDataroompay.onetime_Fee);
    let formData = {
      cat_id: cat_id,
    };
    if (aiadd === "") {
      setOpenDocPopupKey(null);
      seteditdeleteBtn(null);
    }
    try {
      const res = await axios.post(apiURLAiFile + "getcategoryname", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      const respo = res.data.row;
      setcatgeoryId(cat_id);
      setsubcatgeoryId(sub_id);
      if (CheckOnetimePay === false) {
        if (DataRoom_InvestReporint === false) {
          setShowPopup(true);
        } else {
          setIsModalOpen(true);
        }
        //setShowPopup(true);
      } else {
        setIsModalOpen(true);
      }
      if (respo.length > 0) {
        setCategorynameFile(respo[0].name);
      } else {
        setCategorynameFile("Others");
      }
    } catch (err) { }
  };
  const handlePaynow = () => {
    setpaynowOneTime(true);
    setpayinfo(false);
  };
  const handleClosepayPopup = () => {
    setShowPopup(false);
    setshowPopupPerInstance(false);
    setpaynowOneTime(false);
  };
  const [editdeleteBtn, seteditdeleteBtn] = useState(null);
  const [DeleteIdDocs, setDeleteIdDocs] = useState("");
  const [openDocPopups, setOpenDocPopups] = React.useState({});
  const [openDocPopupKey, setOpenDocPopupKey] = useState(null);
  const [showDropdown, setShowDropdown] = useState(null);
  const [Docname, setDocname] = useState("");
  const [docId, setdocId] = useState("");
  const handleEdit = (docId, docname) => {
    seteditdeleteBtn(null);

    setDocname(docname);
    setIsModalOpenUpdate(true);
  };

  const handleDelete = async (docId, lockcheck, aistatus, lockStatus) => {
    if (lockcheck === "Yes" && aistatus === "Yes" && lockStatus === "Yes") {
      let formData = {
        company_id: userLogin.companies[0].id,
        docId: docId,
      };
      try {
        const res = await axios.post(
          apiURLAiFile + "lockFileCheckSubscription",
          formData,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json", // Ensure the content type is JSON
            },
          }
        );
        console.log(res.data);
      } catch (err) { }
    } else {
      setdangerMessage("Are you sure? You want to delete this file");
      //setOpenDocPopupKey(null);
    }
  };

  const togglePopup = (categoryId, subcategoryId) => {
    const key = `${categoryId}-${subcategoryId}`;
    setOpenDocPopupKey((prevKey) => (prevKey === key ? null : key));
  };

  const refreshpage = () => {
    getcategories();
    setIsModalOpen(false);
    getDocumentcheck();
  };

  const toggleDropdownEditDelete = (id) => {
    setDeleteIdDocs(id);
    seteditdeleteBtn((prevId) => (prevId === id ? null : id));
  };
  const handleConfirm = async () => {
    let formData = {
      id: DeleteIdDocs,
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "UserDocDeleteFile",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      getcategories();
      seteditdeleteBtn(null);
      setdangerMessage("");
      const respo = res.data.message;
      setmessageAll(respo);
      seterr(true);
      setTimeout(() => {
        seterr(false);
        setmessageAll("");
      }, 1000);
      //setdangerMessagealert(respo);
    } catch (err) { }
  };
  const handleDownload = async (company_id, id, filename, folder_name) => {
    try {
      const response = await axios.post(
        apiURLAiFile + "filedownload",
        { company_id, folderName: folder_name, filename },
        {
          responseType: "blob", // ✅ Important: tells axios to expect a binary file
        }
      );

      // Create blob URL and trigger download
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert("Download failed");
      console.error(err);
    }
  };
  const [IsModalOpenAiResponse, setIsModalOpenAiResponse] = useState(false);
  const [AIquestions, setAIquestions] = useState([]);
  const [IsModalOpenAiResponseSummary, setIsModalOpenAiResponseSummary] =
    useState(false);
  const [AiUpdatesummaryID, setAiUpdatesummaryID] = useState("");
  const [AISummary, setAISummary] = useState("");
  const handleEditViewSummary = async (userId, id) => {
    let formData = {
      id: id,
      user_id: userId,
    };
    setAiUpdatesummaryID(id);
    try {
      const res = await axios.post(apiURLAiFile + "getAISummary", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });

      setAISummary(res.data.results);
      setIsModalOpenAiResponseSummary(true);
    } catch (err) { }
  };
  const handleAttendAIquestion = async (userId, id) => {
    let formData = {
      id: id,
      user_id: userId,
    };
    try {
      const res = await axios.post(apiURLAiFile + "getAIquestion", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });

      setAIquestions(res.data.results);
      setIsModalOpenAiResponse(true);
    } catch (err) { }
  };
  const refreshpageAi = () => {
    setIsModalOpenAiResponse(false);
    setIsModalOpenAiResponseSummary(false);
    getcategories();
  };
  const handleApprovedFile = async (id) => {
    let formData = {
      id: id[0],
    };

    try {
      const res = await axios.post(apiURLAiFile + "fileApproved", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      getcategories();
    } catch (err) { }
  };
  const [showPopupPerInstance, setshowPopupPerInstance] = useState(false);
  const handleFinaldoc = async () => {
    let formData = {
      user_id: userLogin.id,
    };

    if (Documentcheck === false) {
      // setdangerMessagealertDoc(
      //   "You do not have permission, Please upload the documents "
      // );
    } else {
      setdangerMessagealert(
        "⚠️ Before proceeding, confirm that all required documents have been uploaded. Clicking forward will impact your credit balance, and this action cannot be undone."
      );
    }

    // try {
    //   const res = await axios.post(apiURLAiFile + "generateDocFile", formData, {
    //     headers: {
    //       Accept: "application/json",
    //       "Content-Type": "application/json", // Ensure the content type is JSON
    //     },
    //   });
    // } catch (err) {}
  };
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [textgeneratebtn, settextgeneratebtn] = useState(
    "Generate Executive Summary"
  );
  const [messageAll, setmessageAll] = useState("");
  const handleConfirmProcess = async () => {
    let formData = {
      company_id: userLogin.companies[0].id,
    };

    setdangerMessagealert("");
    try {
      const res = await axios.post(
        apiURLAiFile + "checkuserSubscriptionThreeMonth",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );

      if (res.data.results.length > 0) {
        var payid = res.data.results;
        let formDataa = {
          company_id: userLogin.companies[0].id,
          created_by_role: userLogin.role,
          created_by_id: userLogin.id,
          payid: payid[0].id,
        };
        setPayidOnetime(payid[0].id);
        try {
          const res = await axios.post(
            apiURLAiFile + "perInstancePayment",
            formDataa,
            {
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json", // Ensure the content type is JSON
              },
            }
          );

          if (res.data.allowGeneration) {
            settextgeneratebtn("Please don't refresh the page");
            setProgress(0);
            setLoading(true);

            const interval = setInterval(() => {
              setProgress((oldProgress) => {
                if (oldProgress >= 95) return oldProgress;
                return Math.min(oldProgress + Math.random() * 10, 95); // increase with random increments
              });
            }, 500);
            setdangerMessagealert("");
            setspinnerss(true);
            setcheckReferCodepay(true);
            try {
              const generateRes = await axios.post(
                apiURLAiFile + "generateProcessAI",
                formDataa,
                {
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                  },
                }
              );
              var dataa = generateRes.data;
              if (dataa.status === "2") {
                setspinnerss(false);
                setLoading(false);
                seterrr(true);
                setnormallyMessage(dataa.message);
                settextgeneratebtn("Generate Executive Summary");
                setTimeout(() => {
                  seterrr(false);
                  setnormallyMessage("");
                }, 1200);
              } else {
                clearInterval(interval);
                setProgress(100);
                setspinnerss(false);
                setTimeout(() => {
                  setLoading(false);
                  navigate("/approvalpage/" + dataa.code);
                }, 500);
              }
            } catch (err) {
              console.error("Error generating summary", err);
            }
          } else {
            // Not allowed — needs to pay 100 EUR
            setpaymentType("Perinstance");

            setcheckReferCodepay(false);
            setshowPopupPerInstance(true);
          }
        } catch (err) { }
      } else {
        // setmainamount(getDataroompay.onetime_Fee);
        setShowPopup(true);
        setrenew(true);
      }
    } catch (err) { }
  };
  //Upload Company Logo
  const [companyLogo, setCompanyLogo] = useState(null);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCompanyLogo(file); // Store file object
    setCompanyLogoUrl(URL.createObjectURL(file));
    const formDataa = new FormData();
    formDataa.append("logo", file);
    formDataa.append("user_id", userLogin.id); // Pass user_id for folder creation

    try {
      const response = await axios.post(
        `${apiURLAiFile}uploadcompanyLogo`,
        formDataa,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );
      console.log("Logo uploaded:", response.data);
    } catch (err) {
      console.error("Error uploading logo:", err);
    }
  };
  const lockunlockId = () => {
    if (subcatgeoryId) {
      setlockId(subcatgeoryId);

      var msg =
        "To generate a diligence report, all documents in the data room must be locked.\n" +
        "This document is editable until the first diligence report is generated.\n\n" +
        "I want to lock this document.";
      setdangerMessagealertLockUnlock(msg);
    }
  };
  const handleConfirmProcessLockUnlock = async () => {
    let formData = {
      company_id: userLogin.companies[0].id,
      lockId: lockId,
    };

    try {
      const res = await axios.post(apiURLAiFile + "filelock", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      setnormallyMessage("Documents locked successfully");
      setTimeout(() => {
        getcategories();
        setdangerMessagealertLockUnlock("");
        setnormallyMessage("");
        getDocumentcheck();
      }, 1200);
    } catch (err) { }
  };
  const handleEditFile = async (
    docid,
    docname,
    lockcheck,
    catidd,
    lok,
    ailock
  ) => {
    console.log(lockcheck, ailock);
    setDocname(docname);
    setdocId(docid);
    if (ailock === "Yes" && lockcheck === "Yes" && lok === "Yes") {
      let formData = {
        user_id: userLogin.id,
      };
      try {
        const res = await axios.post(
          apiURLAiFile + "lockFileCheckSubscription",
          formData,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json", // Ensure the content type is JSON
            },
          }
        );
        if (res.data.allowEdit === true) {
          setisModalOpenLockFile(true);
        } else {
          let formData = {
            cat_id: catidd,
          };
          try {
            const res = await axios.post(
              apiURLAiFile + "getcategoryname",
              formData,
              {
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json", // Ensure the content type is JSON
                },
              }
            );
            const respo = res.data.row;
            setcatgeoryId(catidd);
            setIsModalOpenUpdate(true);
            if (respo.length > 0) {
              setCategorynameFile(respo[0].name);
            } else {
              setCategorynameFile("Others");
            }
          } catch (err) { }
        }
      } catch (err) { }
    } else {
      let formData = {
        cat_id: catidd,
      };
      try {
        const res = await axios.post(
          apiURLAiFile + "getcategoryname",
          formData,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json", // Ensure the content type is JSON
            },
          }
        );
        const respo = res.data.row;
        setcatgeoryId(catidd);
        setIsModalOpenUpdate(true);
        if (respo.length > 0) {
          setCategorynameFile(respo[0].name);
        } else {
          setCategorynameFile("Others");
        }
      } catch (err) { }
    }
  };
  const handleCheckpaymentdoc = async (catId, subId) => {
    let formData = {
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "lockFileCheckSubscription",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );

      if (res.data.allowEdit === true) {
        setisModalOpenLockFile(true);
      } else {
        // handleUploadDocument(catId, subId);
        // setIsModalOpenUpdate(true);
      }
    } catch (err) { }
  };
  //Lock Unlock
  const handleLockUnlockFile = async (companyid, id, lock, ailock) => {
    let formData = {
      company_id: userLogin.companies[0].id,
      id: id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "fileslockorUnlock",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      setnormallyMessage(res.data.message);
      setTimeout(() => {
        getcategories();
        setnormallyMessage("");
      }, 1200);
    } catch (err) { }
  };
  const handleLockAllFile = () => {
    setdangerMessagealertAllLock(
      "Are you sure you want to lock all documents? This is required to generate a new diligence report."
    );
  };
  const handleConfirmProcessAllLock = async () => {
    let formData = {
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(apiURLAiFile + "allfileslock", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      setnormallyMessage(res.data.message);
      if (res.data.status === "1") {
        seterrr(false);
      } else {
        seterrr(true);
      }
      setTimeout(() => {
        seterrr(false);
        setdangerMessagealertAllLock("");
        getcategories();
        setnormallyMessage("");
      }, 1200);
    } catch (err) { }
  };
  //Lock Unlock
  //Export Doc Net Profit
  useEffect(() => {
    //getCompanynetprofile();
  }, []);
  const getCompanynetprofile = async () => {
    let formData = {
      company_name: "Google",
    };

    try {
      const res = await axios.post(
        apiURLAiFile + "getAllExchangeCompanyData",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      console.log(res);
    } catch (err) { }
  };
  //Export Doc Net Profit
  const [isCollapsed, setIsCollapsed] = useState(false);
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          {messageAll && (
            <p className={err ? " mt-3 error_pop" : "success_pop mt-3"}>
              {messageAll}
            </p>
          )}
          {dangerMessage && (
            <DangerAlertPopup
              message={dangerMessage}
              onConfirm={handleConfirm}
              onCancel={() => {
                setdangerMessage("");
              }}
            />
          )}
          {dangerMessagealert && (
            <DangerAlertPopup
              message={dangerMessagealert}
              onConfirm={handleConfirmProcess}
              onCancel={() => {
                setdangerMessagealert("");
              }}
            />
          )}
          {dangerMessagealertLockUnlock && (
            <DangerAlertPopup
              message={dangerMessagealertLockUnlock}
              onConfirm={handleConfirmProcessLockUnlock}
              onCancel={() => {
                setdangerMessagealertLockUnlock("");
              }}
            />
          )}
          {dangerMessagealertAllLock && (
            <DangerAlertPopup
              message={dangerMessagealertAllLock}
              onConfirm={handleConfirmProcessAllLock}
              onCancel={() => {
                setdangerMessagealertAllLock("");
              }}
            />
          )}
          {dangerMessagealertDoc && (
            <DangerAlertPopupMessage
              message={dangerMessagealertDoc}
              onClose={() => {
                setdangerMessagealertDoc("");
              }}
            />
          )}
          {normallyMessage && (
            <p className={errr ? " mt-3 error_pop" : "success_pop mt-3"}>
              {normallyMessage}
            </p>
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
                  <DataRoomSection className="d-flex flex-column gap-4">
                    <div className="pb-3 bar_design">
                      <h4 className="h5 mb-0">
                        Dataroom Management & Executive Summary
                      </h4>
                    </div>
                    <div className="titleroom d-flex m-0 flex-wrap gap-3 justify-content-between align-items-center text-center">
                      <button
                        type="button"
                        disabled={
                          spinnerss || authorizedData?.approve !== "Yes"
                        } // ✅ disable if spinner or not approved
                        style={{
                          opacity:
                            spinnerss || authorizedData?.approve !== "Yes"
                              ? 0.6
                              : 1,
                        }}
                        onClick={handleFinaldoc}
                        className="generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2"
                      >
                        <span
                          style={{
                            opacity:
                              !Documentcheck ||
                                authorizedData?.approve !== "Yes"
                                ? 0.6
                                : 1,
                          }}
                        >
                          {textgeneratebtn}
                        </span>
                        {spinnerss && (
                          <div
                            className="spinner-color spinner-border spinneronetimepay m-0"
                            role="status"
                          >
                            <span className="visually-hidden"></span>
                          </div>
                        )}
                      </button>

                      {/* <button
                        type="button"
                        onClick={handleLockAllFile}
                        className="generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2"
                      >
                        <span>Signature to Approval</span>
                      </button> */}
                      {userLogin.role !== "owner" && (
                        <Link
                          to="/authorized-signature"
                          className="generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2"
                        >
                          <span>
                            {authorizedData?.approve === "Yes"
                              ? "Approved Signature"
                              : "Signature to Approval"}
                          </span>
                        </Link>
                      )}
                    </div>
                    {/* {loading && (
                      <div className="mt-6">
                        <div className="bg-gray-200 rounded-full h-4">
                          <div
                            className="bg-green-500 h-4 rounded-full transition-all duration-200"
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                        <p className="text-center mt-2">
                          {Math.floor(progress)}%
                        </p>
                      </div>
                    )} */}

                    <div className="table-responsive d-flex flex-column gap-3">
                      {categories.map((category) => {
                        const tooltipIdd = `tooltip-${category.category_id}`;
                        const tooltipIddd = `tooltipex-${category.category_id}`;
                        const tooltipIddd_doc = `tooltipDoc-${category.category_id}`;

                        return (
                          <div className="overflow-auto">
                            <table
                              key={category.id}
                              className="table document_table"
                            >
                              <thead>
                                <tr>
                                  <TableHeader>
                                    {category.name}{" "}
                                    {category.category_tips && (
                                      <>
                                        <span
                                          className="tooltip-icon"
                                          data-tooltip-id={`tt-cat-${category.id}`}
                                          data-tooltip-html={
                                            category.category_tips
                                          }
                                        >
                                          <img
                                            className="blackdark"
                                            width="15"
                                            height="15"
                                            src="/assets/user/images/question.png"
                                            alt="Tip"
                                          />
                                        </span>

                                        <Tooltip
                                          id={`tt-cat-${category.id}`}
                                          place="top"
                                          float
                                          interactive={true}
                                          className="custom-tooltip"
                                          positionStrategy="fixed"
                                        />
                                      </>
                                    )}
                                  </TableHeader>

                                  <TableHeader>Upload Documents</TableHeader>

                                  <TableHeader>
                                    Manage Documents
                                    {category.do_not_exits && (
                                      <>
                                        <span
                                          className="tooltip-icon"
                                          data-tooltip-id={`tt-doc-${category.id}`}
                                          data-tooltip-html={
                                            category.do_not_exits
                                          }
                                        >
                                          <img
                                            className="blackdark"
                                            width="15"
                                            height="15"
                                            src="/assets/user/images/question.png"
                                            alt="Tip"
                                          />
                                        </span>

                                        <Tooltip
                                          id={`tt-doc-${category.id}`}
                                          place="top"
                                          float
                                          interactive={true}
                                          className="custom-tooltip"
                                          positionStrategy="fixed"
                                        />
                                      </>
                                    )}
                                  </TableHeader>

                                  <TableHeader>
                                    Exists but NOT Available
                                    {category.exits_tips && (
                                      <>
                                        <span
                                          className="tooltip-icon"
                                          data-tooltip-id={`tt-exit-${category.id}`}
                                          data-tooltip-html={
                                            category.exits_tips
                                          }
                                        >
                                          <img
                                            className="blackdark"
                                            width="15"
                                            height="15"
                                            src="/assets/user/images/question.png"
                                            alt="Tip"
                                          />
                                        </span>

                                        <Tooltip
                                          id={`tt-exit-${category.id}`}
                                          place="top"
                                          float
                                          interactive={true}
                                          className="custom-tooltip"
                                          positionStrategy="fixed"
                                        />
                                      </>
                                    )}
                                  </TableHeader>

                                  <TableHeader>Provided</TableHeader>
                                </tr>
                              </thead>
                              {category.subcategories &&
                                category.subcategories.length > 0 ? (
                                <tbody>
                                  {category.subcategories.map((sub, index) => {
                                    const tooltipId = `tooltip-${category.id}-${sub.id}`;
                                    const key = `${category.id}-${sub.id}`;

                                    return (
                                      <tr key={sub.id}>
                                        <TableData>
                                          <h6>
                                            {sub.name}
                                            {sub.tips && (
                                              <>
                                                <span
                                                  data-tooltip-id={`tooltipSub-${category.id}-${sub.id}`}
                                                  data-tooltip-html={sub.tips}
                                                  className="tooltip-icon"
                                                >
                                                  <img
                                                    className="blackdark"
                                                    width="15"
                                                    height="15"
                                                    src="/assets/user/images/question.png"
                                                    alt="Tip"
                                                  />
                                                </span>
                                                <Tooltip
                                                  id={`tooltipSub-${category.id}-${sub.id}`}
                                                  place="top"
                                                  float
                                                  interactive={true}
                                                  className="custom-tooltip"
                                                  positionStrategy="fixed"
                                                />
                                              </>
                                            )}
                                          </h6>
                                        </TableData>

                                        <TableData>
                                          <UploadButton
                                            type="button"
                                            onClick={() => {
                                              if (sub.Ai_generate !== "Yes") {
                                                handleUploadDocument(
                                                  category.id,
                                                  sub.id
                                                );
                                              } else {
                                                if (sub.lockStatus === "Yes") {
                                                  handleCheckpaymentdoc(
                                                    category.id,
                                                    sub.id
                                                  );
                                                } else {
                                                  // handleUploadDocument(
                                                  //   category.id,
                                                  //   sub.id
                                                  // );
                                                }
                                              }
                                            }}
                                          >
                                            {sub.documents.length > 0 ? (
                                              <span>
                                                {sub.Ai_generate === "Yes" ? (
                                                  <>
                                                    {sub.lockStatus ===
                                                      "Yes" ? (
                                                      <>
                                                        Lock{" "}
                                                        <Lock
                                                          size={16}
                                                          className="text-white"
                                                          title="Locked"
                                                        />
                                                      </>
                                                    ) : (
                                                      <>
                                                        Lock{" "}
                                                        <Lock
                                                          size={16}
                                                          className="text-white"
                                                          title="Locked"
                                                        />
                                                      </>
                                                    )}
                                                  </>
                                                ) : (
                                                  <>
                                                    Add <FaPlus />
                                                  </>
                                                )}
                                              </span>
                                            ) : (
                                              <span
                                                style={{ whiteSpace: "nowrap" }}
                                                className="d-block"
                                              >
                                                Click to upload
                                              </span>
                                            )}
                                          </UploadButton>
                                        </TableData>

                                        <TableData>
                                          {sub.documents &&
                                            sub.documents.length > 0 ? (
                                            <>
                                              <UploadButton
                                                type="button"
                                                onClick={() =>
                                                  togglePopup(
                                                    category.id,
                                                    sub.id
                                                  )
                                                }
                                              >
                                                {openDocPopupKey ===
                                                  `${category.id}-${sub.id}`
                                                  ? "Hide Documents"
                                                  : "View Documents"}
                                              </UploadButton>

                                              {openDocPopupKey ===
                                                `${category.id}-${sub.id}` && (
                                                  <div className="main_popup-overlay">
                                                    <div className="popupDataRoom">
                                                      <div className="uploadFilescroll position-relative">
                                                        <div className="d-flex mb-2 pop_bg justify-content-between align-items-center p-2">
                                                          <h4 className="docName">
                                                            {sub.name}
                                                          </h4>
                                                          <div className="d-flex gap-2 align-items-center">
                                                            <button
                                                              type="button"
                                                              className="bg-transparent text-white p-1 border-0"
                                                              onClick={() =>
                                                                togglePopup(
                                                                  category.id,
                                                                  sub.id
                                                                )
                                                              }
                                                            >
                                                              <IoCloseCircleOutline
                                                                size={24}
                                                              />
                                                            </button>
                                                          </div>
                                                        </div>

                                                        <ol className="text-start text-capitalize px-3 pdflist">
                                                          {sub.documents.map(
                                                            (doc, index) => (
                                                              <li key={doc.id}>
                                                                <span className="d-flex justify-content-between align-items-center">
                                                                  <span className="d-flex align-items-center gap-2">
                                                                    {index + 1}.
                                                                    <>
                                                                      {doc.locked ===
                                                                        "Yes" ? (
                                                                        <Lock
                                                                          size={
                                                                            14
                                                                          }
                                                                          style={{
                                                                            color:
                                                                              "var(--primary)",
                                                                          }}
                                                                          title="Locked"
                                                                        />
                                                                      ) : (
                                                                        <Unlock
                                                                          size={
                                                                            14
                                                                          }
                                                                          className="text-success"
                                                                          title="Unlocked"
                                                                        />
                                                                      )}
                                                                    </>
                                                                    {doc.name}
                                                                  </span>

                                                                  <div className="d-inline ">
                                                                    <button
                                                                      title="More actions"
                                                                      className="btn btn-link p-0 text-dark"
                                                                      type="button"
                                                                      onClick={() =>
                                                                        toggleDropdownEditDelete(
                                                                          doc.id
                                                                        )
                                                                      }
                                                                    >
                                                                      <MoreHorizontal
                                                                        width={16}
                                                                        height={
                                                                          16
                                                                        }
                                                                      />
                                                                    </button>

                                                                    {editdeleteBtn ===
                                                                      doc.id && (
                                                                        <div
                                                                          style={{
                                                                            position:
                                                                              "absolute",
                                                                            width:
                                                                              "100px",
                                                                            backgroundColor:
                                                                              "#fff",
                                                                            boxShadow:
                                                                              "0 2px 5px rgba(0,0,0,0.2)",
                                                                            padding:
                                                                              "2px",
                                                                            zIndex: 997,
                                                                            right: 0,
                                                                          }}
                                                                        >
                                                                          <button
                                                                            type="button"
                                                                            title="Download"
                                                                            className="editdelete-links"
                                                                            onClick={() =>
                                                                              handleDownload(
                                                                                doc.company_id,
                                                                                doc.id,
                                                                                doc.name,
                                                                                doc.folder_name
                                                                              )
                                                                            }
                                                                          >
                                                                            <Download
                                                                              className="me-1"
                                                                              width={
                                                                                12
                                                                              }
                                                                              height={
                                                                                10
                                                                              }
                                                                            />
                                                                            Download
                                                                          </button>

                                                                          <button
                                                                            type="button"
                                                                            title={
                                                                              doc.Ai_generate ===
                                                                                "Yes"
                                                                                ? "Yes"
                                                                                : "No"
                                                                            }
                                                                            className="editdelete-links"
                                                                          >
                                                                            <Brain
                                                                              className="me-1 text-white"
                                                                              width={
                                                                                12
                                                                              }
                                                                              height={
                                                                                10
                                                                              }
                                                                            />
                                                                            {doc.Ai_generate ===
                                                                              "Yes"
                                                                              ? "AI Yes"
                                                                              : "AI No"}
                                                                          </button>
                                                                          {doc.Ai_generate ===
                                                                            "No" && (
                                                                              <button
                                                                                onClick={() =>
                                                                                  handleLockUnlockFile(
                                                                                    doc.company_id,
                                                                                    doc.document_id,
                                                                                    doc.locked,
                                                                                    doc.Ai_generate
                                                                                  )
                                                                                }
                                                                                type="button"
                                                                                title={
                                                                                  doc.locked ===
                                                                                    "Yes"
                                                                                    ? "Unlock"
                                                                                    : "Lock"
                                                                                }
                                                                                className="editdelete-links"
                                                                              >
                                                                                {doc.locked ===
                                                                                  "Yes" ? (
                                                                                  <Unlock
                                                                                    className="me-1 text-white"
                                                                                    width={
                                                                                      12
                                                                                    }
                                                                                    height={
                                                                                      10
                                                                                    }
                                                                                  />
                                                                                ) : (
                                                                                  <Lock
                                                                                    className="me-1 text-white"
                                                                                    width={
                                                                                      12
                                                                                    }
                                                                                    height={
                                                                                      10
                                                                                    }
                                                                                  />
                                                                                )}
                                                                                {doc.locked ===
                                                                                  "Yes"
                                                                                  ? "Unlock"
                                                                                  : "Lock"}
                                                                              </button>
                                                                            )}
                                                                          <button
                                                                            type="button"
                                                                            title="Edit"
                                                                            className="editdelete-links"
                                                                            style={{
                                                                              opacity:
                                                                                doc.Ai_generate ===
                                                                                  "Yes" &&
                                                                                  sub.lockStatus ===
                                                                                  "Yes"
                                                                                  ? 0.6
                                                                                  : 1,
                                                                              pointerEvents:
                                                                                doc.Ai_generate ===
                                                                                  "Yes" &&
                                                                                  sub.lockStatus ===
                                                                                  "Yes"
                                                                                  ? "none"
                                                                                  : "auto",
                                                                            }}
                                                                            onClick={() =>
                                                                              handleEditFile(
                                                                                doc.id,
                                                                                doc.name,
                                                                                doc.lockStatus,
                                                                                category.id,
                                                                                doc.locked,
                                                                                doc.Ai_generate
                                                                              )
                                                                            }
                                                                          >
                                                                            <Pencil
                                                                              className="me-1 text-white"
                                                                              width={
                                                                                10
                                                                              }
                                                                              height={
                                                                                10
                                                                              }
                                                                            />
                                                                            {doc.Ai_generate ===
                                                                              "Yes"
                                                                              ? "Replace"
                                                                              : "Edit"}
                                                                          </button>
                                                                          {doc.Ai_generate ===
                                                                            "Yes" && (
                                                                              <button
                                                                                type="button"
                                                                                title="Add"
                                                                                className="editdelete-links"
                                                                                onClick={() =>
                                                                                  handleUploadDocument(
                                                                                    category.id,
                                                                                    sub.id,
                                                                                    "1"
                                                                                  )
                                                                                }
                                                                                style={{
                                                                                  opacity:
                                                                                    doc.Ai_generate ===
                                                                                      "Yes" &&
                                                                                      sub.lockStatus ===
                                                                                      "Yes"
                                                                                      ? 0.6
                                                                                      : 1,
                                                                                  pointerEvents:
                                                                                    doc.Ai_generate ===
                                                                                      "Yes" &&
                                                                                      sub.lockStatus ===
                                                                                      "Yes"
                                                                                      ? "none"
                                                                                      : "auto",
                                                                                }}
                                                                              >
                                                                                <FaPlus
                                                                                  className="me-1"
                                                                                  width={
                                                                                    10
                                                                                  }
                                                                                  height={
                                                                                    10
                                                                                  }
                                                                                />
                                                                                Add
                                                                              </button>
                                                                            )}
                                                                          <button
                                                                            type="button"
                                                                            title="Delete"
                                                                            className="editdelete-links"
                                                                            style={{
                                                                              opacity:
                                                                                doc.Ai_generate ===
                                                                                  "Yes" &&
                                                                                  sub.lockStatus ===
                                                                                  "Yes"
                                                                                  ? 0.6
                                                                                  : 1,
                                                                              pointerEvents:
                                                                                doc.Ai_generate ===
                                                                                  "Yes" &&
                                                                                  sub.lockStatus ===
                                                                                  "Yes"
                                                                                  ? "none"
                                                                                  : "auto",
                                                                            }}
                                                                            onClick={() =>
                                                                              handleDelete(
                                                                                doc.id,
                                                                                doc.locked,
                                                                                doc.Ai_generate,
                                                                                doc.lockStatus
                                                                              )
                                                                            }
                                                                          >
                                                                            <Trash2
                                                                              className="me-1"
                                                                              width={
                                                                                10
                                                                              }
                                                                              height={
                                                                                10
                                                                              }
                                                                            />
                                                                            Delete
                                                                          </button>
                                                                        </div>
                                                                      )}
                                                                  </div>
                                                                </span>
                                                              </li>
                                                            )
                                                          )}
                                                        </ol>

                                                        <button
                                                          className="btn btn-outline-dark"
                                                          type="button"
                                                          onClick={() =>
                                                            togglePopup(
                                                              category.id,
                                                              sub.id
                                                            )
                                                          }
                                                        >
                                                          <FaTimes />
                                                        </button>
                                                      </div>
                                                    </div>
                                                  </div>
                                                )}
                                            </>
                                          ) : (
                                            <span>N/A</span>
                                          )}
                                        </TableData>

                                        <TableData>
                                          <h5>--</h5>
                                        </TableData>
                                        <TableData>
                                          {sub.documents.length > 0 ? (
                                            <p>Yes</p>
                                          ) : (
                                            <span>--</span>
                                          )}
                                        </TableData>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              ) : (
                                <tbody>
                                  <tr>
                                    <TableData colSpan={5}>
                                      <p>No subcategories</p>
                                    </TableData>
                                  </tr>
                                </tbody>
                              )}
                            </table>
                          </div>
                        );
                      })}
                      <div className="titleroom d-flex justify-content-between align-items-center text-center">
                        <button
                          type="button"
                          disabled={
                            spinnerss || authorizedData?.approve !== "Yes"
                          } // ✅ disable if spinner or not approved
                          style={{
                            opacity:
                              spinnerss || authorizedData?.approve !== "Yes"
                                ? 0.6
                                : 1,
                          }}
                          onClick={handleFinaldoc}
                          className="generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2"
                        >
                          <span
                            style={{
                              opacity:
                                !Documentcheck ||
                                  authorizedData?.approve !== "Yes"
                                  ? 0.6
                                  : 1,
                            }}
                          >
                            {textgeneratebtn}
                          </span>
                          {spinnerss && (
                            <div
                              className="spinner-color spinner-border spinneronetimepay m-0"
                              role="status"
                            >
                              <span className="visually-hidden"></span>
                            </div>
                          )}
                        </button>

                        {/* Upload Company Logo Section */}
                        {/* <div className="d-flex align-items-center gap-3">
                          <input
                            type="file"
                            accept="image/*"
                            id="companyLogo"
                            style={{ display: "none" }}
                            onChange={handleLogoUpload} // You must define this handler
                          />
                          <label
                            htmlFor="companyLogo"
                            className="btn btn-outline-primary m-0"
                          >
                            Upload Company Logo
                          </label>

                          {companyLogoUrl && (
                            <>
                              <img
                                src={companyLogoUrl}
                                alt="Company Logo"
                                height="40"
                                style={{
                                  objectFit: "contain",
                                  maxWidth: "150px",
                                  cursor: "pointer",
                                }}
                                onClick={() => setShowModalViewlogo(true)}
                              />

                              {showModalViewlogo && (
                                <div
                                  style={{
                                    position: "fixed",
                                    top: 0,
                                    left: 0,
                                    width: "100vw",
                                    height: "100vh",
                                    backgroundColor: "rgba(0, 0, 0, 0.7)",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    zIndex: 9999,
                                  }}
                                  onClick={() => setShowModalViewlogo(false)} // background click
                                >
                                  <div
                                    style={{
                                      position: "relative",
                                    }}
                                    onClick={(e) => e.stopPropagation()} // prevent background close on image click
                                  >
                                    <span
                                      onClick={() =>
                                        setShowModalViewlogo(false)
                                      }
                                      style={{
                                        position: "absolute",
                                        top: "-20px",
                                        right: "-20px",
                                        background: "#fff",
                                        color: "#000",
                                        borderRadius: "50%",
                                        padding: "4px 10px",
                                        cursor: "pointer",
                                        fontWeight: "bold",
                                        fontSize: "18px",
                                        boxShadow: "0 0 5px rgba(0,0,0,0.5)",
                                      }}
                                    >
                                      ✖
                                    </span>
                                    <img
                                      src={companyLogoUrl}
                                      alt="Full Logo"
                                      style={{
                                        maxWidth: "90vw",
                                        maxHeight: "90vh",
                                        borderRadius: "8px",
                                        boxShadow: "0 0 10px #fff",
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div> */}
                      </div>
                    </div>
                  </DataRoomSection>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>

      {/* pop up */}
      {isModalOpen && (
        <UploadModal
          onClose={() => setIsModalOpen(false)}
          catgeoryId={catgeoryId}
          subcatgeoryId={subcatgeoryId}
          CategorynameFile={CategorynameFile}
          refreshpage={refreshpage}
          lockunlockId={lockunlockId}
        />
      )}
      {isModalOpenLockFile && (
        <LockFilePayment onClose={() => setisModalOpenLockFile(false)} />
      )}
      {isModalOpenUpdate && (
        <UploadModalUpdate
          onClose={() => setIsModalOpenUpdate(false)}
          catgeoryId={catgeoryId}
          subcatgeoryId={subcatgeoryId}
          CategorynameFile={CategorynameFile}
          refreshpage={refreshpage}
          Docname={Docname}
          DeleteIdDocs={DeleteIdDocs}
          docId={docId}
        />
      )}
      {IsModalOpenAiResponse && (
        <AiQuestionForm
          onClose={() => setIsModalOpenAiResponse(false)}
          catgeoryId={catgeoryId}
          subcatgeoryId={subcatgeoryId}
          CategorynameFile={CategorynameFile}
          refreshpageAi={refreshpageAi}
          Docname={Docname}
          DeleteIdDocs={DeleteIdDocs}
          AIquestions={AIquestions}
        />
      )}
      {IsModalOpenAiResponseSummary && (
        <AiSummaryForm
          onClose={() => setIsModalOpenAiResponseSummary(false)}
          AiUpdatesummaryID={AiUpdatesummaryID}
          refreshpageAi={refreshpageAi}
          AISummary={AISummary}
        />
      )}
      {/*Payment */}
      {showPopup && (
        <AirwallexPaymentPopupOneTimeDataroom
          show={showPopup}
          onClose={() => setShowPopup(false)}
          payment={getDataroompay.onetime_Fee}
          referstatus={checkReferCodepay}
        />
      )}
      {/*Payment */}
      {/* {showPopup && (
        <div className="payment_modal-overlay" onClick={handleClosepayPopup}>
          <div
            className="modal-container scroll_bar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-section">
                <h5 className="modal-title">Payment</h5>

                {payinfo && (
                  <div className="price-tag">
                    €{getDataroompay.onetime_Fee}
                    <span className="billing-cycle">/year</span>
                  </div>
                )}
                <p>
                  {" "}
                  <strong>
                    {" "}
                    Dataroom Management & Diligence + Investor Reporting
                  </strong>
                </p>
              </div>
              <button
                type="button"
                className="close_btn_global"
                onClick={handleClosepayPopup}
                aria-label="Close"
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>

            {payinfo && (
              <div className="payment-info">
                <div className="benefits-list">
                  <div className="benefits-list">
                    <div className="benefit-item">
                      <div className="benefit-icon">
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M22 4L12 14.01L9 11.01"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div className="benefit-text">
                        <strong>Dataroom Management:</strong> Centralize key
                        investor documents and streamline your due diligence
                        prep. Receive one free executive summary to share with
                        investors; additional copies cost €
                        {getDataroompay.perInstance_Fee} each.
                      </div>
                    </div>

                    <div className="benefit-item">
                      <div className="benefit-icon">
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M22 4L12 14.01L9 11.01"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div className="benefit-text">
                        <strong>Cap Table Management:</strong> Know who owns
                        what in your company.
                      </div>
                    </div>

                    <div className="benefit-item">
                      <div className="benefit-icon">
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M22 4L12 14.01L9 11.01"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div className="benefit-text">
                        <strong>Investor Reporting:</strong> Ensure that you
                        connect with your investors with updates. No more “out
                        of sight, out of mind!”
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="payment-methods">
              <div className="accepted-cards">
                <span className="accepted-text">We accept:</span>
                <div className="card-icons">
                  <div className="text-center mb-4">
                    <img
                      src="/assets/user/images/cardimage.jpg"
                      alt="cards"
                      className="img-fluid rounded"
                      style={{ maxWidth: "200px" }}
                    />
                  </div>
                </div>
              </div>

              <div className="stripe-form-container">
                <Elements stripe={stripePromise}>
                  <CheckoutForm
                    payment={getDataroompay.onetime_Fee}
                    referstatus={checkReferCodepay}
                  />
                </Elements>
              </div>
            </div>
          </div>
        </div>
      )} */}
      {showPopupPerInstance && (
        <AirwallexPaymentPopupPerInstanceDataroom
          show={showPopupPerInstance}
          onClose={() => setshowPopupPerInstance(false)}
          payment={getDataroompay.perInstance_Fee}
          usersubscriptiondataroomone_time_id={PayidOnetime}
        />
      )}
      {/* {showPopupPerInstance && (
        <>
          <div
            className="modal fade show d-block"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
            tabIndex="-1"
            role="dialog"
            aria-labelledby="paymentModalLabel"
            aria-hidden="false"
          >
            <div className="modal-dialog modal-dialog-centered modal-lg">
              <div className="modal-content rounded-4 shadow-lg p-4">
                <button
                  type="button"
                  className="btn-close position-absolute top-0 end-0 m-3"
                  onClick={handleClosepayPopup}
                  aria-label="Close"
                ></button>
                {payinfo && (
                  <>
                    <h2
                      className="modal-title text-center fw-bold text-dark mb-4"
                      id="paymentModalLabel"
                    >
                      Payment
                    </h2>

                    <div className="mb-4">
                      <h5 className="fw-bold text-dark mb-2">
                        Dataroom Management & Diligence
                      </h5>
                    </div>

                    <div className="mb-4">
                      <div className="fs-4 fw-semibold text-dark">
                        Fee:{" "}
                        <span style={{ color: "#2e5692" }} className="fw-bold">
                          €{getDataroompay.perInstance_Fee}
                        </span>{" "}
                        <span className="fs-6 text-muted">
                          (Per Additional Copy)
                        </span>
                      </div>

                      <ul className="list-group list-group-flush mt-3">
                        <li className="list-group-item text-dark ps-0">
                          <strong>Receive one free executive summary</strong> to
                          share with investors; additional copies cost{" "}
                          <strong>€{getDataroompay.perInstance_Fee}</strong>{" "}
                          each.
                        </li>
                      </ul>
                    </div>
                  </>
                )}

                <div className="text-center mb-4">
                  <img
                    src="/assets/user/images/cardimage.jpg"
                    alt="cards"
                    className="img-fluid rounded"
                    style={{ maxWidth: "200px" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )} */}
    </>
  );
}
