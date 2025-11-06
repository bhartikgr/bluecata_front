import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "react-router-dom";

import axios from "axios";
import { MdViewModule } from "react-icons/md";
import "bootstrap/dist/css/bootstrap.min.css";

function Header({ isOpen }) {
  const location = useLocation();
  useEffect(() => {
    const checkAndAppend = (elementType, elementAttributes) => {
      let existingElement;
      if (elementType === "link") {
        existingElement = document.querySelector(
          `link[href="${elementAttributes.href}"]`
        );
      } else if (elementType === "script") {
        existingElement = document.querySelector(
          `script[src="${elementAttributes.src}"]`
        );
      }

      if (!existingElement) {
        const element = document.createElement(elementType);
        Object.keys(elementAttributes).forEach((key) => {
          element.setAttribute(key, elementAttributes[key]);
        });
        document.head.appendChild(element);
      }
    };

    // Add WebFont script dynamically
    checkAndAppend("script", {
      src: "../../assets/adminnew/js/plugin/webfont/webfont.min.js",
      async: true,
    });

    // Add CSS Files
    checkAndAppend("link", {
      rel: "stylesheet",
      href: "../../assets/adminnew/css/bootstrap.min.css",
    });
    checkAndAppend("link", {
      rel: "stylesheet",
      href: "../../assets/adminnew/css/plugins.min.css",
    });
    checkAndAppend("link", {
      rel: "stylesheet",
      href: "../../assets/adminnew/css/kaiadmin.min.css",
    });
    checkAndAppend("link", {
      rel: "stylesheet",
      href: "../../assets/adminnew/css/demo.css",
    });

    // Load WebFont after the script has been added
    // const intervalId = setInterval(() => {
    //   if (window.WebFont) {
    //     WebFont.load({
    //       google: {
    //         families: ["Public Sans:300,400,500,600,700"],
    //       },
    //       custom: {
    //         families: [
    //           "Font Awesome 5 Solid",
    //           "Font Awesome 5 Regular",
    //           "Font Awesome 5 Brands",
    //           "simple-line-icons",
    //         ],
    //         urls: ["../../assets/adminnew/css/fonts.min.css"],
    //       },
    //       active: function () {
    //         localStorage.fonts = true;
    //       },
    //     });
    //     clearInterval(intervalId); // Stop checking once WebFont is loaded
    //   }
    // }, 100); // Check every 100ms if WebFont has been loaded

    return () => {
      // Clean up the resources when the component is unmounted
      const linksToRemove = [
        "../../assets/adminnew/css/bootstrap.min.css",
        "../../assets/adminnew/css/plugins.min.css",
        "../../assets/adminnew/css/kaiadmin.min.css",
        "../../assets/adminnew/css/demo.css",
      ];

      linksToRemove.forEach((href) => {
        const link = document.querySelector(`link[href="${href}"]`);
        if (link && link.parentNode) {
          link.parentNode.removeChild(link);
        }
      });

      const scriptsToRemove = [
        "../../assets/adminnew/js/plugin/webfont/webfont.min.js",
      ];

      scriptsToRemove.forEach((src) => {
        const script = document.querySelector(`script[src="${src}"]`);
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
      });
    };
  }, []);

  useEffect(() => {
    const checkAndAppend = (elementType, elementAttributes) => {
      let existingElement;
      if (elementType === "script") {
        existingElement = document.querySelector(
          `script[src="${elementAttributes.src}"]`
        );
      }

      if (!existingElement) {
        const element = document.createElement(elementType);
        Object.keys(elementAttributes).forEach((key) => {
          element.setAttribute(key, elementAttributes[key]);
        });
        document.body.appendChild(element);
      }
    };

    // List of all script files to load
    const scripts = [
      "../../assets/adminnew/js/core/jquery-3.7.1.min.js",
      "../../assets/adminnew/js/core/popper.min.js",
      "../../assets/adminnew/js/core/bootstrap.min.js",
      "../../assets/adminnew/js/plugin/jquery-scrollbar/jquery.scrollbar.min.js",
      "../../assets/adminnew/js/plugin/chart.js/chart.min.js",
      "../../assets/adminnew/js/plugin/jquery.sparkline/jquery.sparkline.min.js",
      "../../assets/adminnew/js/plugin/chart-circle/circles.min.js",
      "../../assets/adminnew/js/plugin/datatables/datatables.min.js",
      "../../assets/adminnew/js/plugin/bootstrap-notify/bootstrap-notify.min.js",
      "../../assets/adminnew/js/plugin/jsvectormap/jsvectormap.min.js",
      "../../assets/adminnew/js/plugin/datatables/datatables.min.js",
      "../../assets/adminnew/js/plugin/jsvectormap/world.js",
      "../../assets/adminnew/js/plugin/sweetalert/sweetalert.min.js",
      "../../assets/adminnew/js/kaiadmin.min.js",
      "../../assets/adminnew/js/setting-demo.js",
    ];

    // Dynamically append each script
    scripts.forEach((src) => {
      checkAndAppend("script", { src });
    });

    return () => {
      // Cleanup: Remove the scripts when the component is unmounted
      scripts.forEach((src) => {
        const script = document.querySelector(`script[src="${src}"]`);
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
      });
    };
  }, []);
  const currentYear = new Date().getFullYear();

  return (
    <>
      <footer className="footer">
        <div className="container-fluid d-flex justify-content-between">
          <div className="copyright">
            {currentYear}, made with{" "}
            <i className="fa fa-heart heart text-danger"></i> by
          </div>
        </div>
      </footer>
    </>
  );
}

export default Header;
