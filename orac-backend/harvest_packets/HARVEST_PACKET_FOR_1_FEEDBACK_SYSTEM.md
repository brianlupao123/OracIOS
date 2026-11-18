# HARVEST PACKET FOR 1-FEEDBACK-SYSTEM CHAT
*(Copy everything below this line and paste it into your 1-Feedback-System conversation)*

---

Hello 1-Feedback Agent! We are implementing **Subsystem 11 (Client Feedback, NPS & Executive Reporting)** and **Universal QR Code Optical Workflows (Section 16)** in the **ORAC Industrial ERP** system.

We want to harvest your battle-tested code patterns:
- Your **`qrcode` generation and launch engine** (`api/routes/evaluation.route.js` and `client/src/pages/QrLaunch.jsx`).
- Your **automated PowerPoint slide deck generator (`pptxgenjs`)**.
- Your **post-job customer satisfaction and Net Promoter Score (NPS) feedback engine**.

### What ORAC Needs for Sprint 5 (Feedback, NPS & Universal QR Engine):
1. **QR Code Service (`backend/src/services/qrCodeService.js`):**
   - Implements `qrcode` package to generate high-speed SVG/DataURL codes with embedded HMAC-SHA256 signatures for:
     - `GET /api/equipment/qr/:tagId`: Generates QR sticker for physical mine equipment (pumps/pulleys).
     - `GET /api/worksheets/qr/:id`: Generates touchless mobile sign-off QR for client mining engineers.
     - `GET /api/technicians/qr/:id`: Generates artisan kiosk badge QR for 1-second crew clock-in.
     - `GET /api/public/verify/qr/:jobId`: Generates public job warranty verification QR.
2. **Executive QBR Presentation Service (`backend/src/services/pptxExportService.js`):**
   - Implements `pptxgenjs` to generate a branded 16:9 executive Quarterly Business Review slide deck containing:
     - Total jobs completed across mine sites (Zimplats, Unki, Mimosa).
     - Overall rubber lining wear performance and equipment uptime metrics.
     - Average Client NPS rating and breakdown of positive/neutral/negative reviews.
     - Returns a clean `.pptx` binary buffer for download.
3. **Client Feedback Controller (`backend/src/controllers/clientFeedbackController.js`):**
   - `POST /api/feedback/submit`: Captures 1-to-5 star rating, NPS score (0–10), and client comments tied to an ORAC `dispatch_card_id` and `invoice_id`.
   - Supervisor triage alert if rating is $\le 3$ stars.
4. **Automated Test Suite (`backend/tests/clientFeedbackAndQr.test.js`):**
   - Native Node.js test runner (`import test from 'node:test'`, `import assert from 'node:assert'`).
   - Tests QR generation, feedback submission, NPS calculation, and PPTX slide buffer generation.

---

### REFERENCE CONTEXT FROM ORAC MASTER TRACKER:

#### Subsystem 11: Client Feedback, NPS & Executive Reporting (Target: 100%)
| Item | Target Status | Notes & Specifications |
| :--- | :--- | :--- |
| Post-Job Rating Survey | DONE | 1-click rating survey sent upon dispatch/invoice completion. |
| Net Promoter Score (NPS) Engine | DONE | Automated satisfaction scoring (Promoters, Passives, Detractors). |
| Negative Rating Alerts | DONE | Ratings $\le 3$ stars trigger immediate supervisor triage alert. |
| Automated PowerPoint QBR Export | DONE | `pptxgenjs` automated slide decks for mining client quarterly reviews. |

#### Section 16: Universal QR Code Workflows
- **R-1 (Technician):** Scan Equipment Tag QR on mine plant to auto-populate timesheet.
- **R-2 (Supervisor):** Scan Artisan Badge QR at Kiosk for 1-sec crew clock-in.
- **R-6 (Client):** Scan Worksheet QR on mobile for touchless digital sign-off.
- **R-7 (Public):** Scan Quote/Plate QR to verify genuine ORAC wear warranty.

Please generate the complete, self-contained code blocks now!
