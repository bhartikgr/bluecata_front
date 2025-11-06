import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Users,
  Home,
  Blocks,
  LayoutDashboard,
  Menu,
  X,
  Settings,
} from "lucide-react";

function Sidebar() {
  //const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const location = useLocation();
  const activeItemRef = useRef(null);

  // Scroll to active menu item on mount or route change
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: "auto", // <- instant scroll
        block: "nearest",
      });
    }
  }, [location.pathname]);

  // Utility Functions
  const isActive = (paths) => paths.includes(location.pathname);
  const isActivePath = (patterns) =>
    patterns.some((pattern) =>
      typeof pattern === "string"
        ? location.pathname === pattern
        : pattern instanceof RegExp && pattern.test(location.pathname)
    );
  const isActivePrefix = (prefixes) =>
    prefixes.some((prefix) => location.pathname.startsWith(prefix));

  // Helper to attach ref only to active
  const getRefIfActive = (condition) => (condition ? activeItemRef : null);
  return (
    <>
      <div
        style={{ position: "fixed", zIndex: "98" }}
        className="d-xl-none   d-flex flex-column p-3 px-4 gap-2 justify-content-between align-items-center"
      >
        <div className="d-flex flex-column gap-2 justify-content-center align-items-center">
          <button className="btn btn-dark " onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          {/* <ul className="list-unstyled dash_scroll">
            <li
              className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                isActive(["/admin/dashboard"]) ? "color_primary" : ""
              }`}
            >
              <Link
                to="/admin/dashboard"
                className=" d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Home size={20} />
              </Link>
            </li>

            <li
              className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                isActive(["/admin/company"]) ? "color_primary" : ""
              }`}
            >
              <Link
                to="/admin/company"
                className=" d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Building size={20} />
              </Link>
            </li>

            <li
              className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                isActive(["/admin/video/list", "/admin/video/add"])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/video/list"
                className=" d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <VideoIcon size={20} />
              </Link>
            </li>

            <li
              className={`p-2 rounded d-flex flex-column gap-2 mb-2 ${
                isActivePath([
                  "/admin/module/list",
                  "/admin/module/add",
                  /^\/admin\/module\/edit\/\d+$/,
                  "admin/zoomeetlist",
                  "admin/createzoomeet",
                ])
                  ? ""
                  : ""
              }`}
            >
              <div className="d-flex align-items-center gap-2 ">
                <Blocks size={20} />
              </div>
              <ul className="ms-4 list-unstyled">
                <li
                  className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                    isActivePath([
                      "/admin/module/list",
                      "/admin/module/add",
                      /^\/admin\/module\/edit\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/module/list"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Module List
                  </Link>
                </li>
                <li
                  className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                    isActivePath([
                      "/admin/zoomeetlist",
                      "/admin/createzoomeet",
                      /^\/admin\/editzoomeet\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/zoomeetlist"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Zoom Meeting List
                  </Link>
                </li>
                <li
                  className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                    isActivePath(["/admin/emailtemplate"])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/emailtemplate"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Email Template
                  </Link>
                </li>
              </ul>
            </li>

            <li
              className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                isActivePath([
                  "/admin/duediligencecategoryList",
                  "/admin/duediligencecategory/add",
                  /^\/admin\/duediligencecategorytip\/add\/\d+$/,
                ])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/duediligencecategoryList"
                className=" d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Home size={20} />
              </Link>
            </li>
            <li
              className={`p-2 rounded d-flex flex-column gap-2 mb-2 ${
                isActivePrefix([
                  "/admin/setting/dataroompaymentadd",
                  "/admin/setting/paymentdiscountlist",
                ])
                  ? "color_primary"
                  : ""
              }`}
            >
              <div className="d-flex align-items-center gap-2 ">
                <Settings size={20} />
              </div>
              <ul className="ms-4 list-unstyled">
                <li
                  className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                    isActive(["/admin/setting/dataroompaymentadd"])
                      ? "active "
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/setting/dataroompaymentadd"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    DataRoom Due Diligence Academy
                  </Link>
                </li>
                <li
                  className={`py-3  px-2 d-flex align-items-center gap-2 mb-2  border-bottom ${
                    isActivePath([
                      "/admin/setting/paymentdiscountlist",
                      "/admin/setting/createpaymentdiscount",
                      /^\/admin\/setting\/discountCode\/edit\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/setting/paymentdiscountlist"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Discount Codes
                  </Link>
                </li>
              </ul>
            </li>
          </ul> */}
        </div>
      </div>

      {/* Sidebar */}
      <div
        className={`side_bar_admin  vh-100 shadow-xl p-4 position-fixed  top-0 start-0 ${
          isOpen ? "d-flex" : "d-none"
        } d-xl-flex flex-column justify-content-between`}
        style={{ width: "300px", flexShrink: "0" }}
      >
        <div className="d-flex flex-column gap-3">
          <div className="side_logo">
            <img
              className="w-100 h-100 object-fit-cover"
              src={require("../../assets/images/capavate.png")}
              alt="logo"
            />
          </div>
          <button
            className="close_btn_admin d-xl-none d-block"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          <div className="d-flex align-items-center gap-2 pt-3">
            <LayoutDashboard size={26} />
            <h4 className="m-0 fw-bold">Admin Panel</h4>
          </div>

          <ul
            className="list-unstyled dash_scroll d-flex flex-column gap-2 py-3"
            style={{ maxHeight: "74vh", overflowY: "auto" }}
          >
            <li
              ref={getRefIfActive(isActive(["/admin/dashboard"]))}
              className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                isActive(["/admin/dashboard"]) ? "color_primary" : ""
              }`}
            >
              <Link
                to="/admin/dashboard"
                className="d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Home size={20} /> <span>Dashboard</span>
              </Link>
            </li>
            <li
              ref={getRefIfActive(
                isActivePath([
                  "/admin/users",
                  /^\/admin\/users\/company\/\d+$/,
                  /^\/admin\/company\/investor-reporting\/\d+$/,
                  /^\/admin\/company\/record-round\/\d+$/,
                  /^\/admin\/users\/company\/cap-table\/\d+$/,
                  /^\/admin\/users\/company\/investor-info\/\d+$/,
                  /^\/admin\/users\/company\/info\/\d+$/,
                  /^\/admin\/company\/viewdetails\/\d+$/,
                ])
              )}
              className={`p-2 d-flex align-items-center gap-2 mb-2 border-bottom ${
                isActivePath([
                  "/admin/users",
                  /^\/admin\/users\/company\/\d+$/,
                  /^\/admin\/company\/investor-reporting\/\d+$/,
                  /^\/admin\/company\/record-round\/\d+$/,
                  /^\/admin\/users\/company\/cap-table\/\d+$/,
                  /^\/admin\/users\/company\/investor-info\/\d+$/,
                  /^\/admin\/users\/company\/info\/\d+$/,
                  /^\/admin\/company\/viewdetails\/\d+$/,
                ])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/users"
                className="d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Users size={20} /> <span>Users</span>
              </Link>
            </li>
            <li
              ref={getRefIfActive(
                isActivePath([
                  "/admin/investor",
                  /^\/admin\/investor-info\/\d+$/,
                  /^\/admin\/investor\/viewdetails\/\d+$/,
                ])
              )}
              className={`p-2 d-flex align-items-center gap-2 mb-2 border-bottom ${
                isActivePath([
                  "/admin/investor",
                  /^\/admin\/investor-info\/\d+$/,
                  /^\/admin\/investor\/viewdetails\/\d+$/,
                ])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/investor"
                className="d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Users size={20} /> <span>Investors</span>
              </Link>
            </li>

            {/* <li
              ref={getRefIfActive(
                isActivePath([
                  "/admin/company",
                  /^\/admin\/company\/subscription\/view\/\d+$/,
                  /^\/admin\/company\/viewdetails\/\d+$/,
                  /^\/admin\/company\/sharedreferral\/\d+$/,
                  /^\/admin\/company\/referralcompany\/\d+$/,
                  /^\/admin\/company\/referralused\/[\w-]+\/\d+$/,
                  /^\/admin\/company\/referralcodes\/[\w-]+\/\d+$/,
                ])
              )}
              className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                isActivePath([
                  "/admin/company",
                  /^\/admin\/company\/subscription\/view\/\d+$/,
                  /^\/admin\/company\/viewdetails\/\d+$/,
                  /^\/admin\/company\/sharedreferral\/\d+$/,
                  /^\/admin\/company\/referralcompany\/\d+$/,
                  /^\/admin\/company\/referralused\/[\w-]+\/\d+$/,
                  /^\/admin\/company\/referralcodes\/[\w-]+\/\d+$/,
                ])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/company"
                className=" d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Building size={20} /> <span>Registered Companies</span>
              </Link>
            </li> */}

            {/* <li
              ref={getRefIfActive(
                isActive(["/admin/video/list", "/admin/video/add"])
              )}
              className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                isActive(["/admin/video/list", "/admin/video/add"])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/video/list"
                className=" d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <VideoIcon size={20} /> <span>Video Management</span>
              </Link>
            </li> */}

            <li className="p-2 rounded d-flex flex-column gap-2 mb-2">
              <div className="d-flex align-items-center gap-2 ">
                <Blocks size={20} /> <span>Modules</span>
              </div>

              <ul className="ms-4 list-unstyled">
                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/module/list",
                      "/admin/module/add",
                      /^\/admin\/module\/edit\/\d+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/module/list",
                      "/admin/module/add",
                      /^\/admin\/module\/edit\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/module/list"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Module List
                  </Link>
                </li>

                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/zoomeetlist",
                      "/admin/createzoomeet",
                      /^\/admin\/editzoomeet\/\d+$/,
                      /^\/admin\/zoomeetlist\/useregister\/\d+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/zoomeetlist",
                      "/admin/createzoomeet",
                      /^\/admin\/editzoomeet\/\d+$/,
                      /^\/admin\/zoomeetlist\/useregister\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/zoomeetlist"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Zoom Meeting List
                  </Link>
                </li>

                <li
                  ref={getRefIfActive(isActivePath(["/admin/emailtemplate"]))}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath(["/admin/emailtemplate"])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/emailtemplate"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Email Template
                  </Link>
                </li>
              </ul>
            </li>

            {/* Add the rest of your menu similarly... */}
            {/* <li
              ref={getRefIfActive(
                isActive(["/admin/investor/views", "/admin/investor/viewdata"])
              )}
              className={`p-2 rounded d-flex flex-column gap-2 mb-2 ${
                isActive(["/admin/investor/views", "/admin/investor/viewdata"])
                  ? "color_primary"
                  : ""
              }`}
            >
              <div className="d-flex align-items-center gap-2 ">
                <Blocks size={20} /> <span>Investor Views</span>
              </div>

              <ul className="ms-4 list-unstyled">
                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/investor/investorupdates",
                      /^\/admin\/investor\/detail\/investorupdates\/\d+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/investor/investorupdates",
                      /^\/admin\/investor\/detail\/investorupdates\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/investor/investorupdates"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Investor Update Reports
                  </Link>
                </li>

                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/investor/duedelidocument",
                      /^\/admin\/investor\/detail\/duedelidocument\/\d+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/investor/duedelidocument",
                      /^\/admin\/investor\/detail\/duedelidocument\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/investor/duedelidocument"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Due Diligence Document
                  </Link>
                </li>

                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/investor/termsheet",
                      /^\/admin\/investor\/detail\/termsheet\/\d+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/investor/termsheet",
                      /^\/admin\/investor\/detail\/termsheet\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/investor/termsheet"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Term Sheet
                  </Link>
                </li>

                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/investor/subscriptiondoc",
                      /^\/admin\/investor\/detail\/subscriptiondoc\/\d+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/investor/subscriptiondoc",
                      /^\/admin\/investor\/detail\/subscriptiondoc\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/investor/subscriptiondoc"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Subscription Document
                  </Link>
                </li>

                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/investor/dataroom",
                      /^\/admin\/investor\/detail\/dataroom\/\d+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/investor/dataroom",
                      /^\/admin\/investor\/detail\/dataroom\/\d+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/investor/dataroom"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Dataroom
                  </Link>
                </li>
              </ul>
            </li> */}
            <li
              ref={getRefIfActive(
                isActive([
                  "/admin/duediligencecategoryList",
                  "/admin/duediligencecategory/add",
                  /^\/admin\/duediligencecategorytip\/add\/\d+$/,
                ])
              )}
              className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                isActivePath([
                  "/admin/duediligencecategoryList",
                  "/admin/duediligencecategory/add",
                  /^\/admin\/duediligencecategorytip\/add\/\d+$/,
                ])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/duediligencecategoryList"
                className=" d-flex align-items-center gap-2 text-decoration-none w-100"
              >
                <Home size={20} /> <span>Data Rooms Category</span>
              </Link>
            </li>

            <li className="p-2 rounded d-flex flex-column gap-2 mb-2">
              <div className="d-flex align-items-center gap-2 ">
                <Settings size={20} /> <span>Setting</span>
              </div>

              <ul className="ms-4 list-unstyled">
                <li
                  ref={getRefIfActive(
                    isActive(["/admin/setting/dataroompaymentadd"])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActive(["/admin/setting/dataroompaymentadd"])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/setting/dataroompaymentadd"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Subscription Amount
                  </Link>
                </li>

                <li
                  ref={getRefIfActive(
                    isActivePath([
                      "/admin/setting/paymentdiscountlist",
                      "/admin/setting/createpaymentdiscount",
                      /^\/admin\/setting\/discountCode\/edit\/\d+$/,
                      /^\/admin\/setting\/referralcodes\/[\w-]+$/,
                      /^\/admin\/setting\/referralusage\/[\w-]+$/,
                    ])
                  )}
                  className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                    isActivePath([
                      "/admin/setting/paymentdiscountlist",
                      "/admin/setting/createpaymentdiscount",
                      /^\/admin\/setting\/discountCode\/edit\/\d+$/,
                      /^\/admin\/setting\/referralcodes\/[\w-]+$/,
                      /^\/admin\/setting\/referralusage\/[\w-]+$/,
                    ])
                      ? "color_primary"
                      : ""
                  }`}
                >
                  <Link
                    to="/admin/setting/paymentdiscountlist"
                    className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
                  >
                    Discount Codes
                  </Link>
                </li>
              </ul>
            </li>
            {/* <li
              ref={getRefIfActive(
                isActivePath([
                  "/admin/setting/broadcastsession",
                  "/admin/setting/broadcast/addsession",

                  /^\/admin\/setting\/tracking\/view\/[\w-]+\/\d+$/,
                  /^\/admin\/setting\/broadcast\/editsession\/\d+$/,
                  ,
                ])
              )}
              className={`p-2  d-flex align-items-center gap-2 mb-2 border-bottom ${
                isActivePath([
                  "/admin/setting/broadcastsession",
                  "/admin/setting/broadcast/addsession",

                  /^\/admin\/setting\/tracking\/view\/[\w-]+\/\d+$/,
                  /^\/admin\/setting\/broadcast\/editsession\/\d+$/,
                ])
                  ? "color_primary"
                  : ""
              }`}
            >
              <Link
                to="/admin/setting/broadcastsession"
                className=" d-flex align-items-center gap-2 text-decoration-none py-1 submenu_new"
              >
                Broadcasts Session
              </Link>
            </li> */}
          </ul>
        </div>
      </div>
    </>
  );
}

export default Sidebar;
