import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import RecordOfWorkDossier from "./RecordOfWorkDossier.jsx";
import TradesAndRatesModal from "./TradesAndRatesModal.jsx";
import { canAccessRoute } from "../accessPolicy.js";

export default function QuickActionsBar({ user }) {
  const navigate = useNavigate();
  const [dossierOpen, setDossierOpen] = useState(false);
  const [tradesModalOpen, setTradesModalOpen] = useState(false);

  const role = user?.role || "Technician";

  // Build role-specific quick action cards
  const getActions = () => {
    switch (role) {
      case "Admin":
        return [
          {
            id: "onboard_worker",
            title: "Onboard Worker",
            subtitle: "Create technician profile",
            tone: "accent",
            path: "/admin",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            ),
            onClick: () => navigate("/admin")
          },
          {
            id: "record_of_work",
            title: "Record of Work",
            subtitle: "360° Client & Site Dossier",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "trades_and_rates",
            title: "Trades & Rates",
            subtitle: "Master wage rates & skills",
            tone: "success",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            onClick: () => setTradesModalOpen(true)
          },
          {
            id: "bulk_import",
            title: "Data Import",
            subtitle: "Batch upload Excel records",
            tone: "warning",
            path: "/imports",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            ),
            onClick: () => navigate("/imports")
          },
          {
            id: "commercial_ledger",
            title: "PO & Invoicing",
            subtitle: "Financial settlement",
            tone: "danger",
            path: "/finance",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            ),
            onClick: () => navigate("/finance")
          }
        ];

      case "Management":
        return [
          {
            id: "record_of_work",
            title: "Record of Work",
            subtitle: "360° Client & Site Dossier",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "executive_reports",
            title: "Executive Reports",
            subtitle: "Operations & finance analytics",
            tone: "warning",
            path: "/reports",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            ),
            onClick: () => navigate("/reports")
          },
          {
            id: "quotations",
            title: "Quotations",
            subtitle: "Sales pipeline & approvals",
            tone: "success",
            path: "/quotations",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            ),
            onClick: () => navigate("/quotations")
          },
          {
            id: "trades_and_rates",
            title: "Trades & Rates",
            subtitle: "Master wage rates & skills",
            tone: "accent",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            onClick: () => setTradesModalOpen(true)
          },
          {
            id: "admin_overview",
            title: "Administration",
            subtitle: "Clients & assets setup",
            tone: "danger",
            path: "/admin",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            ),
            onClick: () => navigate("/admin")
          }
        ];

      case "Sales":
        return [
          {
            id: "quotations",
            title: "Quotations",
            subtitle: "Create & track pricing",
            tone: "success",
            path: "/quotations",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            ),
            onClick: () => navigate("/quotations")
          },
          {
            id: "record_of_work",
            title: "Record of Work",
            subtitle: "Client & site dossier",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "service_requests",
            title: "Service Requests",
            subtitle: "Incoming client inquiries",
            tone: "accent",
            path: "/service-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v16H4z M8 9h8 M8 13h5" />
              </svg>
            ),
            onClick: () => navigate("/service-requests")
          },
          {
            id: "timesheets_entry",
            title: "Capture Timesheets",
            subtitle: "Signed paper field entries",
            tone: "warning",
            path: "/worksheets",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            onClick: () => navigate("/worksheets")
          },
          {
            id: "internal_req",
            title: "Internal Request",
            subtitle: "Staff-to-staff coordination",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      case "Finance":
        return [
          {
            id: "po_invoicing",
            title: "PO & Invoicing",
            subtitle: "Contracts & PO balances",
            tone: "info",
            path: "/finance",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => navigate("/finance")
          },
          {
            id: "invoice_readiness",
            title: "Invoice Readiness",
            subtitle: "Unbilled certified work",
            tone: "accent",
            path: "/invoice-readiness",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            ),
            onClick: () => navigate("/invoice-readiness")
          },
          {
            id: "tech_payroll",
            title: "Technician Payroll",
            subtitle: "Certified hours & payroll",
            tone: "success",
            path: "/reports",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            ),
            onClick: () => navigate("/reports")
          },
          {
            id: "record_of_work",
            title: "Site Dossier",
            subtitle: "Audit client work & billing",
            tone: "warning",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_req",
            title: "Internal Request",
            subtitle: "Finance authorizations",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      case "Operations":
      case "Supervisor":
        return [
          {
            id: "timesheets",
            title: "Daily Timesheets",
            subtitle: "Log & verify crew hours",
            tone: "info",
            path: "/worksheets",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            onClick: () => navigate("/worksheets")
          },
          {
            id: "worksheets",
            title: "Monthly Worksheets",
            subtitle: "Client certified registers",
            tone: "success",
            path: "/monthly-worksheets",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => navigate("/monthly-worksheets")
          },
          {
            id: "job_cards",
            title: "Job Cards",
            subtitle: "Field dispatches & tags",
            tone: "warning",
            path: "/job-cards",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            ),
            onClick: () => navigate("/job-cards")
          },
          {
            id: "record_of_work",
            title: "Site Dossier",
            subtitle: "Audit site work records",
            tone: "accent",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_req",
            title: "Mobilization Request",
            subtitle: "Request techs & materials",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      case "Technician":
        return [
          {
            id: "log_shift",
            title: "My Timesheets",
            subtitle: "Enter hours & plant section",
            tone: "info",
            path: "/worksheets",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            onClick: () => navigate("/worksheets")
          },
          {
            id: "my_jobs",
            title: "Assigned Jobs",
            subtitle: "Active site dispatches",
            tone: "warning",
            path: "/job-cards",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            ),
            onClick: () => navigate("/job-cards")
          },
          {
            id: "operational_data",
            title: "Operational Data",
            subtitle: "Field records & equipment",
            tone: "success",
            path: "/operational-data",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => navigate("/operational-data")
          },
          {
            id: "record_of_work",
            title: "Site Dossier",
            subtitle: "Technical site dossier",
            tone: "accent",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_help",
            title: "Submit Request",
            subtitle: "PPE, tools, or assistance",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      case "Client Viewer":
        return [
          {
            id: "record_of_work",
            title: "Record of Work",
            subtitle: "360° Site dossier & audits",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "portal_hub",
            title: "Client Portal",
            subtitle: "Requests, quotes & work",
            tone: "accent",
            path: "/portal",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 11l9-8 9 8 M5 10v10h14V10" />
              </svg>
            ),
            onClick: () => navigate("/portal")
          },
          {
            id: "contracts",
            title: "POs & Contracts",
            subtitle: "Track order balances",
            tone: "success",
            path: "/contracts",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            ),
            onClick: () => navigate("/contracts")
          },
          {
            id: "site_documents",
            title: "Site Documents",
            subtitle: "Service manuals & drawings",
            tone: "warning",
            path: "/documents",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            ),
            onClick: () => navigate("/documents")
          }
        ];

      case "Procurement & Stores":
        return [
          {
            id: "procurement_hub",
            title: "Procurement Hub",
            subtitle: "PR, PO & Goods Receipt (GRN)",
            tone: "accent",
            path: "/procurement",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            ),
            onClick: () => navigate("/procurement")
          },
          {
            id: "inventory_ledger",
            title: "Inventory Stock",
            subtitle: "Stores & stock balances",
            tone: "success",
            path: "/inventory",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            ),
            onClick: () => navigate("/inventory")
          },
          {
            id: "record_of_work",
            title: "Site Dossier",
            subtitle: "Site material requirements",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_req",
            title: "Internal Request",
            subtitle: "Purchase requisitions",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      case "Fleet & Facilities":
        return [
          {
            id: "fleet_logistics",
            title: "Fleet Logistics",
            subtitle: "Vehicles, VID & Insurance",
            tone: "accent",
            path: "/fleet",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
            ),
            onClick: () => navigate("/fleet")
          },
          {
            id: "job_cards",
            title: "Job Dispatches",
            subtitle: "Field trip allocations",
            tone: "warning",
            path: "/job-cards",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            ),
            onClick: () => navigate("/job-cards")
          },
          {
            id: "record_of_work",
            title: "Site Dossier",
            subtitle: "Mine locations & routes",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_req",
            title: "Service Request",
            subtitle: "Vehicle servicing & repairs",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      case "HSE & Quality":
        return [
          {
            id: "hse_compliance",
            title: "HSE Compliance",
            subtitle: "PPE gate, talks & incidents",
            tone: "accent",
            path: "/hse",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            ),
            onClick: () => navigate("/hse")
          },
          {
            id: "job_cards",
            title: "Field Job Cards",
            subtitle: "Site safety clearance",
            tone: "warning",
            path: "/job-cards",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            ),
            onClick: () => navigate("/job-cards")
          },
          {
            id: "record_of_work",
            title: "Site Dossier",
            subtitle: "Site hazard profiles",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_req",
            title: "Safety Request",
            subtitle: "Safety equipment & reports",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      case "Human Resources":
        return [
          {
            id: "artisan_vault",
            title: "Artisan Vault",
            subtitle: "Qualifications & compliance",
            tone: "accent",
            path: "/artisans",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            ),
            onClick: () => navigate("/artisans")
          },
          {
            id: "workforce_roster",
            title: "Workforce Profiles",
            subtitle: "Technicians & artisans",
            tone: "success",
            path: "/admin",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            ),
            onClick: () => navigate("/admin")
          },
          {
            id: "trades_and_rates",
            title: "Trades & Rates",
            subtitle: "Master wage rates & skills",
            tone: "warning",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            onClick: () => setTradesModalOpen(true)
          },
          {
            id: "record_of_work",
            title: "Site Dossier",
            subtitle: "Induction certifications",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_req",
            title: "Internal Request",
            subtitle: "Staffing & training requests",
            tone: "danger",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];

      default:
        return [
          {
            id: "record_of_work",
            title: "Record of Work",
            subtitle: "Client & site dossier",
            tone: "info",
            path: null,
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            onClick: () => setDossierOpen(true)
          },
          {
            id: "internal_req",
            title: "Submit Request",
            subtitle: "Internal team request",
            tone: "accent",
            path: "/internal-requests",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            ),
            onClick: () => navigate("/internal-requests")
          }
        ];
    }
  };

  // Progressive Disclosure: completely filter out any card whose destination path cannot be accessed by the user's role.
  const rawActions = getActions();
  const actions = rawActions.filter((act) => {
    if (!act.path) return true; // Modals are always accessible
    return canAccessRoute(role, act.path);
  });

  function getActionBadgeStyle(variant) {
    switch (variant) {
      case "accent":
        return "bg-orac-accent/10 text-orac-accent border border-orac-accent/20";
      case "success":
        return "bg-orac-success-bg text-orac-success-text border border-orac-success-border";
      case "warning":
        return "bg-orac-warning-bg text-orac-warning-text border border-orac-warning-border";
      case "danger":
        return "bg-orac-danger-bg text-orac-danger-text border border-orac-danger-border";
      case "info":
      default:
        return "bg-orac-info-bg text-orac-info-text border border-orac-info-border";
    }
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-ux-section font-semibold text-orac-text-primary">Quick Actions</span>
          <span className="text-ux-caption text-orac-text-muted">1-Click Operational Shortcuts</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {actions.map((act) => (
            <div
              key={act.id}
              onClick={act.onClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  act.onClick();
                }
              }}
              className="group flex flex-col justify-between rounded-xl border border-orac-border-default bg-orac-surface p-4 shadow-2xs hover:border-orac-accent/40 hover:shadow-xs hover:bg-orac-row-hover transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-orac-accent"
            >
              <div className="flex items-center justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg shadow-2xs transition-transform group-hover:scale-105 ${getActionBadgeStyle(act.tone)}`}>
                  {act.icon}
                </div>
                <span className="text-orac-text-muted group-hover:text-orac-accent group-hover:translate-x-0.5 transition-all text-ux-caption">
                  &rarr;
                </span>
              </div>
              <div className="mt-3">
                <span className="block text-ux-body font-semibold text-orac-text-primary group-hover:text-orac-accent transition-colors">
                  {act.title}
                </span>
                <span className="mt-0.5 block text-ux-caption text-orac-text-muted line-clamp-1">
                  {act.subtitle}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {dossierOpen && (
        <RecordOfWorkDossier isOpen={dossierOpen} onClose={() => setDossierOpen(false)} />
      )}

      {tradesModalOpen && (
        <TradesAndRatesModal isOpen={tradesModalOpen} onClose={() => setTradesModalOpen(false)} />
      )}
    </>
  );
}
