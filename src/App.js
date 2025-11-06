import React, { Component } from "react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import InvestorReport from "./pages/User/Investor/InvestorReport";

import ShareReport from "./pages/User/Investor/ShareReport";
import InvestorDocsharing from "./pages/User/Investordocsharing/InvestorDocsharing";
import InvestorDocsharingprevious from "./pages/User/Investordocsharing/InvestorDocsharingprevious";
import InvestorDocviews from "./pages/User/Investordocsharing/InvestorDocviews";
import InvestorDocsshareView from "./pages/User/Investordocsharing/InvestorDocsshareView";
import AddInvestorReport from "./pages/User/Investor/AddInvestorReport";
import "./App.css";
import "./index.css";
import "./assets/admin/style/style.css";
import "bootstrap/dist/css/bootstrap.min.css";
import { GlobalStyles } from "./components/Styles/GlobalStyles";
import "./capavatestyle.css";
// Lazy load components
const Demopage = lazy(() => import("./pages/Demopage"));

const AdminLogin = lazy(() => import("./pages/Admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/Admin/AdminDashboard"));
const AdminCompany = lazy(() => import("./pages/Admin/AdminCompany"));
const AdminUsers = lazy(() => import("./pages/Admin/AdminUsers"));
const Admininvestor = lazy(() =>
  import("./pages/Admin/Investor/AdminInvestor")
);
const AdminUsersCompany = lazy(() =>
  import("./pages/Admin/Company/AdminUsersCompany")
);
const AdminUsersCompanyInvestorreport = lazy(() =>
  import("./pages/Admin/Company/AdminUsersCompanyInvestorreport")
);
const AdminUsersCompanyRecordRound = lazy(() =>
  import("./pages/Admin/Company/AdminUsersCompanyRecordRound")
);
const AdminCompanyInvestorDetail = lazy(() =>
  import("./pages/Admin/Investor/AdminCompanyInvestorDetail")
);
const AdminCompanyView = lazy(() =>
  import("./pages/Admin/Company/AdminCompanyView")
);
const AdminCompanyInvestorView = lazy(() =>
  import("./pages/Admin/Company/Investor/AdminCompanyInvestorView")
);
const AdminCompanyCaptable = lazy(() =>
  import("./pages/Admin/Company/AdminCompanyCaptable")
);
const AdminCompanyReferralUsed = lazy(() =>
  import("./pages/Admin/AdminCompanyReferralUsed")
);
const AdminCompanySharedReferral = lazy(() =>
  import("./pages/Admin/AdminCompanySharedReferral")
);
const AdminCompanyReferralRegsitered = lazy(() =>
  import("./pages/Admin/AdminCompanyReferralRegsitered")
);
const AdminUserSubscriptionView = lazy(() =>
  import("./pages/Admin/AdminUserSubscriptionView")
);
const AdminUserAllDetails = lazy(() =>
  import("./pages/Admin/AdminUserAllDetails")
);
const AdminInvestorView = lazy(() =>
  import("./pages/Admin/Investor/AdminInvestorView")
);
const AdminVideoList = lazy(() => import("./pages/Admin/Video/AdminVideoList"));
const AdminVideoAdd = lazy(() => import("./pages/Admin/Video/AdminVideoAdd"));
const AdminModuleList = lazy(() =>
  import("./pages/Admin/Module/AdminModuleList")
);
const AdminModuleAdd = lazy(() =>
  import("./pages/Admin/Module/AdminModuleAdd")
);
const UserZoomDetail = lazy(() =>
  import("./pages/Admin/Zoom/AdminUserZoomDetailList")
);
const UserZoomMeetRegister = lazy(() =>
  import("./pages/Admin/Zoom/AdminUserZoomMeetRegister")
);
const AdminZoomCreate = lazy(() =>
  import("./pages/Admin/Zoom/AdminZoomCreate")
);

const AdminUserEmailtemplate = lazy(() =>
  import("./pages/Admin/Zoom/AdminUserEmailtemplate")
);

const UserZoomMetting = lazy(() =>
  import("./pages/Admin/Zoom/AdminUserZoomMetting")
);
const DuediligenceCategory = lazy(() =>
  import("./pages/Admin/Catgeory/AdminDuediligenceCategory")
);
const DuediligenceCategoryadd = lazy(() =>
  import("./pages/Admin/Catgeory/AdminDuediligenceCategoryadd")
);
const AdminDuediligenceCategorynewadd = lazy(() =>
  import("./pages/Admin/Catgeory/AdminDuediligenceCategorynewadd")
);
const AdminPaymentDataRoom = lazy(() =>
  import("./pages/Admin/Setting/AdminPaymentDataRoom")
);
const AdminDiscountCode = lazy(() =>
  import("./pages/Admin/Setting/AdminDiscountCode")
);
const AdminTrackingReferralCode = lazy(() =>
  import("./pages/Admin/Setting/AdminTrackingReferralCode")
);
const AdminTrackingReferralCodeview = lazy(() =>
  import("./pages/Admin/Setting/AdminTrackingReferralCodeview")
);
const AdminTrackingReferralCodeSinigleDetail = lazy(() =>
  import("./pages/Admin/Setting/AdminTrackingReferralCodeSinigleDetail")
);
const AdminDiscountAdd = lazy(() =>
  import("./pages/Admin/Setting/AdminDiscountAdd")
);
const AdminBroadcastSession = lazy(() =>
  import("./pages/Admin/Setting/AdminBroadcastSession")
);
const AdminBroadcastAdd = lazy(() =>
  import("./pages/Admin/Setting/AdminBroadcastAdd")
);
const AdminInvestorUpdate = lazy(() =>
  import("./pages/Admin/Investor/AdminInvestorUpdate")
);
const AdminSingleViews = lazy(() =>
  import("./pages/Admin/Investor/AdminSingleViews")
);
const AdminReferralCodes = lazy(() =>
  import("./pages/Admin/Setting/AdminReferralCodes")
);
const AdminCompanyReferralCodes = lazy(() =>
  import("./pages/Admin/AdminCompanyReferralCodes")
);

const AdminReferralUsage = lazy(() =>
  import("./pages/Admin/Setting/AdminReferralUsage")
);
const AdminTrackingReferralPayment = lazy(() =>
  import("./pages/Admin/Setting/AdminTrackingReferralPayment")
);

// const AdminModuleAdd = lazy(() => import("./pages/Admin/Module/Add"));
const AdminLogout = lazy(() => import("./pages/Admin/AdminLogout"));
//
//
//User

const UserRegister = lazy(() => import("./pages/User/Register"));
const UserRegisterActivateAccount = lazy(() =>
  import("./pages/User/Activateaccount")
);

const AdviceVideos = lazy(() => import("./pages/User/AdviceVideos"));
const ModuleOne = lazy(() => import("./pages/User/ModuleOne"));
const Login = lazy(() => import("./pages/User/Login"));
const Logout = lazy(() => import("./pages/User/Logout"));
const DataroomDiligence = lazy(() => import("./pages/User/DataroomDiligence"));
const Approvalpage = lazy(() => import("./pages/User/Approvalpage"));
const Dashboard = lazy(() => import("./pages/User/Dashboard"));
const Recordround = lazy(() => import("./pages/User/Investor/Recordround"));
const EditRecordround = lazy(() =>
  import("./pages/User/Investor/EditRecordround")
);
const RecordRoundList = lazy(() =>
  import("./pages/User/Investor/RecordRoundList")
);
const RecordRoundCapTable = lazy(() =>
  import("./pages/User/Investor/RecordRoundCaptable")
);

const Subscription = lazy(() => import("./pages/User/Subscription"));
const ZoomMettingPage = lazy(() => import("./pages/User/ZoomMettingPage"));
const Home = lazy(() => import("./pages/User/Home"));
const CardPopup = lazy(() => import("./pages/User/CardPopup"));
const HomeNew = lazy(() => import("./pages/User/HomeNew"));
const ProfileSettings = lazy(() => import("./pages/User/ProfileSettings"));
const Referralcode = lazy(() => import("./pages/User/Referralcode"));
const ReferralcodeTracking = lazy(() =>
  import("./pages/User/ReferralcodeTracking")
);
const InvestorReportPortal = lazy(() =>
  import("./pages/User/Crm/InvestorReportPortal")
);
const InvestorEntry = lazy(() => import("./pages/User/Crm/InvestorEntry"));
const InvestorViewDetails = lazy(() =>
  import("./pages/User/Crm/InvestorViewDetails")
);
const InvestorInvestment = lazy(() =>
  import("./pages/User/Crm/InvestorInvestment")
);
const AddNewInvestor = lazy(() => import("./pages/User/Crm/AddNewInvestor"));
const InvestorReportSharing = lazy(() =>
  import("./pages/User/Crm/InvestorReportSharing")
);
const InvestorRecordReoundConfirm = lazy(() =>
  import("./pages/User/Crm/InvestorRecordReoundConfirm")
);
const InvestorReportView = lazy(() =>
  import("./pages/User/Crm/InvestorReportView")
);
const InvestorReportViewDueDiligence = lazy(() =>
  import("./pages/User/Crm/InvestorReportViewDueDiligence")
);
const InvestorReportViewRecordRound = lazy(() =>
  import("./pages/User/Crm/InvestorReportViewRecordRound")
);

const InvestorReportDashboard = lazy(() =>
  import("./pages/User/Crm/InvestorReportDashboard")
);
const CompanyProfile = lazy(() => import("./pages/User/CompanyProfile"));
//Investor
const Documentview = lazy(() => import("./pages/Investors/Documentview"));
const Allcompany = lazy(() => import("./pages/Investors/Allcompany"));
const Provideform = lazy(() => import("./pages/Investors/Provideform"));
const InvestorLogin = lazy(() => import("./pages/Investors/InvestorLogin"));
const InvestorLogout = lazy(() => import("./pages/Investors/Logout"));
const Investorprofile = lazy(() => import("./pages/Investors/Profile"));

const InvestorDashboard = lazy(() => import("./pages/Investors/Dashboard"));
const InvestorCompanyList = lazy(() => import("./pages/Investors/CompanyList"));
const InvestorMainProfile = lazy(() =>
  import("./pages/Investors/InvestorProfile")
);
const Reportlist = lazy(() => import("./pages/Investors/Reportlist"));
const DueDiligenceReportlist = lazy(() =>
  import("./pages/Investors/DueDiligenceReportlist")
);

const CapitalRoundList = lazy(() =>
  import("./pages/Investors/CapitalRoundList")
);
const CapitalRoundView = lazy(() =>
  import("./pages/Investors/CapitalRoundView")
);
const ActivityLogs = lazy(() => import("./pages/User/ActivityLogs"));
const DiscountCoupon = lazy(() => import("./pages/User/DiscountCoupon"));
const SubscriptionUser = lazy(() => import("./pages/User/SubscriptionUser"));
const Authorizedsignature = lazy(() =>
  import("./pages/User/Authorizedsignature")
);
//investor

//UserDashboard
const UserDashboard = lazy(() =>
  import("./pages/User/UserDashboard/Dashboard")
);
const UserCompanyList = lazy(() =>
  import("./pages/User/UserDashboard/Addcompany/UserCompanyList")
);
const ApprovalSignature = lazy(() =>
  import("./pages/User/UserDashboard/ApprovalSignature")
);
const UserSubscription = lazy(() =>
  import("./pages/User/UserDashboard/Usersubscription")
);
const UserAddCompany = lazy(() =>
  import("./pages/User/UserDashboard/Addcompany/UserAddCompany")
);
//UserDashboard

//UserSignatory
const UserSignatoryList = lazy(() =>
  import("./pages/User/UserSignatory/UserSignatoryList")
);
const SignatoryDashboard = lazy(() =>
  import("./pages/User/UserSignatory/SignatoryDashboard")
);
const UserAddSignatory = lazy(() =>
  import("./pages/User/UserSignatory/UserAddSignatory")
);
const UserProfileSettig = lazy(() =>
  import("./pages/User/UserSetting/UserProfileSettings")
);

const AcceptLink = lazy(() => import("./pages/User/Signatory/AcceptLink"));
const SignatoryLogin = lazy(() => import("./pages/User/Signatory/Login"));
//UserSignatory

//Capavate Home Page
const CapavateHome = lazy(() => import("./pages/CapavateHome"));
class App extends Component {
  render() {
    return (
      <BrowserRouter>
        <div className="App">
          <Suspense
            fallback={
              <div class="d-flex justify-content-center align-items-center min-vh-100">
                <div
                  class="spinner-border spinner-border_loader text-success"
                  role="status"
                ></div>
              </div>
            }
          >
            <GlobalStyles />
            <Routes>
              {/*Capavate Home Page*/}
              <Route path="/capavate/home" element={<CapavateHome />} />{" "}
              {/*Capavate Home Page*/}
              <Route path="/demopage" element={<Demopage />} />{" "}
              <Route path="/admin/login" element={<AdminLogin />} />{" "}
              <Route path="/admin/dashboard" element={<AdminDashboard />} />{" "}
              <Route path="/admin/company" element={<AdminCompany />} />{" "}
              <Route path="/admin/users" element={<AdminUsers />} />{" "}
              <Route path="/admin/investor" element={<Admininvestor />} />{" "}
              <Route
                path="/admin/users/company/:id"
                element={<AdminUsersCompany />}
              />{" "}
              <Route
                path="/admin/company/investor-reporting/:id"
                element={<AdminUsersCompanyInvestorreport />}
              />{" "}
              <Route
                path="/admin/company/record-round/:id"
                element={<AdminUsersCompanyRecordRound />}
              />{" "}
              <Route
                path="/admin/investor-info/:id"
                element={<AdminCompanyInvestorDetail />}
              />{" "}
              <Route
                path="/admin/users/company/info/:id"
                element={<AdminCompanyView />}
              />{" "}
              <Route
                path="/admin/users/company/investor/info/:id"
                element={<AdminCompanyInvestorView />}
              />{" "}
              <Route
                path="/admin/users/company/cap-table/:id"
                element={<AdminCompanyCaptable />}
              />{" "}
              <Route
                path="/admin/company/referralcompany/:id"
                element={<AdminCompanyReferralRegsitered />}
              />{" "}
              <Route
                path="/admin/company/subscription/view/:id"
                element={<AdminUserSubscriptionView />}
              />{" "}
              <Route
                path="/admin/company/viewdetails/:id"
                element={<AdminUserAllDetails />}
              />{" "}
              <Route
                path="/admin/investor/viewdetails/:id"
                element={<AdminInvestorView />}
              />{" "}
              <Route path="/admin/video/list" element={<AdminVideoList />} />{" "}
              <Route path="/admin/video/add" element={<AdminVideoAdd />} />{" "}
              <Route path="/admin/module/list" element={<AdminModuleList />} />{" "}
              <Route path="/admin/module/add" element={<AdminModuleAdd />} />{" "}
              <Route
                path="/admin/module/edit/:id"
                element={<AdminModuleAdd />}
              />{" "}
              <Route path="/admin/zoomeetlist" element={<UserZoomDetail />} />{" "}
              <Route
                path="/admin/zoomeetlist/useregister/:id"
                element={<UserZoomMeetRegister />}
              />{" "}
              <Route
                path="/admin/createzoomeet"
                element={<AdminZoomCreate />}
              />{" "}
              <Route
                path="/admin/emailtemplate"
                element={<AdminUserEmailtemplate />}
              />{" "}
              <Route
                path="/admin/editzoomeet/:id"
                element={<AdminZoomCreate />}
              />{" "}
              <Route
                path="/admin/userzoometting/:id"
                element={<UserZoomMetting />}
              />
              <Route
                path="/admin/duediligencecategoryList/"
                element={<DuediligenceCategory />}
              />
              <Route
                path="/admin/duediligencecategorytip/add/:id"
                element={<DuediligenceCategoryadd />}
              />
              <Route
                path="/admin/duediligencecategory/add"
                element={<AdminDuediligenceCategorynewadd />}
              />
              <Route
                path="/admin/duediligencecategory/edit/:id"
                element={<AdminDuediligenceCategorynewadd />}
              />
              <Route
                path="/admin/setting/dataroompaymentadd"
                element={<AdminPaymentDataRoom />}
              />
              <Route
                path="/admin/setting/tracking/code"
                element={<AdminTrackingReferralCode />}
              />
              <Route
                path="/admin/setting/tracking/code/view/:discount_code"
                element={<AdminTrackingReferralCodeview />}
              />
              <Route
                path="/admin/company/referralused/:discount_code/:id"
                element={<AdminCompanyReferralUsed />}
              />
              <Route
                path="/admin/company/sharedreferral/:id"
                element={<AdminCompanySharedReferral />}
              />
              <Route
                path="/admin/setting/tracking/view/:discount_code/:id"
                element={<AdminTrackingReferralCodeSinigleDetail />}
              />
              <Route
                path="/admin/setting/paymentdiscountlist"
                element={<AdminDiscountCode />}
              />
              <Route
                path="/admin/setting/discountCode/edit/:id"
                element={<AdminDiscountAdd />}
              />
              <Route
                path="/admin/setting/createpaymentdiscount"
                element={<AdminDiscountAdd />}
              />
              <Route
                path="/admin/setting/broadcastsession"
                element={<AdminBroadcastSession />}
              />
              <Route
                path="/admin/setting/broadcast/addsession"
                element={<AdminBroadcastAdd />}
              />
              <Route
                path="/admin/setting/broadcast/editsession/:id"
                element={<AdminBroadcastAdd />}
              />
              <Route
                path="/admin/setting/referralcodes/:code"
                element={<AdminReferralCodes />}
              />
              <Route
                path="/admin/company/referralcodes/:code/:id"
                element={<AdminCompanyReferralCodes />}
              />
              <Route
                path="/admin/setting/referralusage/:code"
                element={<AdminReferralUsage />}
              />
              <Route
                path="/admin/setting/referralusage/paymentinfo/:id"
                element={<AdminTrackingReferralPayment />}
              />
              <Route
                path="/admin/investor/:type"
                element={<AdminInvestorUpdate />}
              />{" "}
              <Route
                path="/admin/investor/detail/:type/:id"
                element={<AdminSingleViews />}
              />{" "}
              <Route path="/investorlist" element={<InvestorReport />} />{" "}
              <Route
                path="/share-with-investorreport"
                element={<ShareReport />}
              />{" "}
              <Route
                path="/investordoc/latest"
                element={<InvestorDocsharing />}
              />{" "}
              <Route
                path="/investordoc/previous"
                element={<InvestorDocsharingprevious />}
              />{" "}
              <Route
                path="/investordocs/view"
                element={<InvestorDocsshareView />}
              />{" "}
              <Route path="/investordocviews" element={<InvestorDocviews />} />{" "}
              <Route path="/add-new-investor" element={<AddInvestorReport />} />{" "}
              <Route path="/admin/logout" element={<AdminLogout />} />
              <Route path="/user/register" element={<UserRegister />} />{" "}
              <Route
                path="/activate-account"
                element={<UserRegisterActivateAccount />}
              />{" "}
              <Route path="/user/login" element={<Login />} />{" "}
              <Route path="/home" element={<HomeNew />} />{" "}
              <Route path="/" element={<HomeNew />} />{" "}
              <Route path="/advicevideos" element={<AdviceVideos />} />{" "}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/createrecord" element={<Recordround />} />{" "}
              <Route path="/edit-record-round/:id" element={<Recordround />} />{" "}
              <Route path="/record-round-list" element={<RecordRoundList />} />{" "}
              <Route
                path="/record-round-cap-table/:id"
                element={<RecordRoundCapTable />}
              />{" "}
              <Route path="/subscription" element={<Subscription />} />{" "}
              <Route path="/zoom/join/:token" element={<ZoomMettingPage />} />{" "}
              <Route path="/moduleone/:id" element={<ModuleOne />} />{" "}
              <Route
                path="/dataroom-Duediligence"
                element={<DataroomDiligence />}
              />{" "}
              <Route path="/approvalpage/:code" element={<Approvalpage />} />{" "}
              <Route path="/payment" element={<CardPopup />} />{" "}
              <Route path="/logout" element={<Logout />} />{" "}
              <Route path="/investor/documentview" element={<Documentview />} />{" "}
              <Route path="/investor/allcompany" element={<Allcompany />} />{" "}
              <Route
                path="/investor/information/:code"
                element={<Provideform />}
              />{" "}
              <Route path="/share/referralcode" element={<Referralcode />} />{" "}
              <Route
                path="/share/referralcodetracking/:id/:discount_code"
                element={<ReferralcodeTracking />}
              />{" "}
              <Route path="/settings/profile" element={<ProfileSettings />} />{" "}
              <Route path="/investor/login" element={<InvestorLogin />} />{" "}
              <Route path="/investor/logout" element={<InvestorLogout />} />{" "}
              <Route path="/investor/profile" element={<Investorprofile />} />{" "}
              <Route
                path="/crm/investor-directory"
                element={<InvestorEntry />}
              />{" "}
              <Route
                path="/crm/investor/investor-info/:id"
                element={<InvestorViewDetails />}
              />{" "}
              <Route
                path="/crm/investorportal"
                element={<InvestorReportPortal />}
              />{" "}
              <Route path="/crm/investment" element={<InvestorInvestment />} />{" "}
              <Route path="/crm/addnew-investor" element={<AddNewInvestor />} />{" "}
              <Route
                path="/crm/edit-investor/:id"
                element={<AddNewInvestor />}
              />{" "}
              <Route
                path="/crm/investorreport"
                element={<InvestorReportSharing />}
              />{" "}
              <Route
                path="/crm/investor-record-round-reports-confirm/:id"
                element={<InvestorRecordReoundConfirm />}
              />{" "}
              <Route
                path="/crm/investor-report-detail/:id"
                element={<InvestorReportView />}
              />{" "}
              <Route
                path="/crm/investor-report-detail-due-diligence/:id"
                element={<InvestorReportViewDueDiligence />}
              />{" "}
              <Route
                path="/crm/investor-report-detail-record-round/:id"
                element={<InvestorReportViewRecordRound />}
              />{" "}
              <Route
                path="/crm/investor-report-dashboard-hostory"
                element={<InvestorReportDashboard />}
              />{" "}
              <Route
                path="/investor/investor-profile"
                element={<InvestorMainProfile />}
              />{" "}
              <Route
                path="/investor/company-list"
                element={<InvestorCompanyList />}
              />{" "}
              <Route
                path="/investor/dashboard"
                element={<InvestorDashboard />}
              />{" "}
              <Route
                path="/investor/company/reportlist/:id"
                element={<Reportlist />}
              />{" "}
              <Route
                path="/investor/company/duediligence-reportlist/:id"
                element={<DueDiligenceReportlist />}
              />{" "}
              <Route
                path="/investor/company/capital-round-list/:id"
                element={<CapitalRoundList />}
              />{" "}
              <Route
                path="/investor/company/capital-round-list/view/:company_id/:id"
                element={<CapitalRoundView />}
              />{" "}
              <Route
                path="/package-subscription"
                element={<SubscriptionUser />}
              />
              <Route
                path="/authorized-signature"
                element={<Authorizedsignature />}
              />
              <Route path="/user/dashboard" element={<UserDashboard />} />
              <Route path="/user/companylist" element={<UserCompanyList />} />
              <Route
                path="/user/approval/signature"
                element={<ApprovalSignature />}
              />
              <Route
                path="/user/subscription-page"
                element={<UserSubscription />}
              />
              <Route path="/user/addcompany" element={<UserAddCompany />} />
              <Route
                path="/user/signatorylist"
                element={<UserSignatoryList />}
              />
              <Route
                path="/user/signatory/activity/:id/:signatory_id"
                element={<SignatoryDashboard />}
              />
              <Route
                path="/user/add-new-signatory"
                element={<UserAddSignatory />}
              />
              <Route
                path="/user/settings/profile"
                element={<UserProfileSettig />}
              />
              <Route path="/signatory/accept/:code" element={<AcceptLink />} />
              <Route path="/signatory/login" element={<SignatoryLogin />} />
              <Route path="/company-profile" element={<CompanyProfile />} />
              <Route path="/activity-logs" element={<ActivityLogs />} />
              <Route path="/discount-coupon" element={<DiscountCoupon />} />
            </Routes>{" "}
          </Suspense>{" "}
        </div>{" "}
      </BrowserRouter>
    );
  }
}

export default App;
