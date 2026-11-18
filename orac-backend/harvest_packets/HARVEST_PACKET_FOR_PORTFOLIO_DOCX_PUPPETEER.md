# HARVEST PROMPT: brian-lupao-portfolio & prof-awasthi-site (Puppeteer PDF, DOCX Generator, Google OAuth 2.0)

**Copy and paste everything below the line into the chat for `brian-lupao-portfolio` or `prof-awasthi-site`:**

---

### Instructions for AI Agent in `brian-lupao-portfolio` / `prof-awasthi-site`

You are contributing code to the **ORAC Industrial ERP System** (heavy mining engineering contractor management for Zimplats, Unki, Mimosa). 
We need to harvest three production-tested modules from your repository:
1. **Puppeteer Headless PDF Generation Engine:** High-fidelity, print-perfect server-side rendering of formal Invoices, Store Issue Vouchers, and QA Certificates (bypassing browser print dialogs).
2. **DOCX Engineering Report & Tender Generator (`docx` library):** Programmatic generation of structured Word documents (.docx) for Mining Plant Survey Reports, Technical Quotation Proposals, and Executive Overviews.
3. **Passport Google OAuth 2.0 Authentication (`passport-google-oauth20`):** Secure single-sign-on (SSO) authentication for Client Mining Engineers and Executive portal access.

---

### Strict ORAC Architectural Constraints:
- **Runtime:** Node.js (CommonJS `require` syntax).
- **Zero Regressions:** Must export modular services that plug directly into `backend/src/services/`.
- **Currency:** USD Only (`$` symbol, 2 decimal places).
- **PDF Styling:** Professional corporate mining contractor format (ORAC branding, A4 page size, print margins, page numbers, digital signature blocks).

---

### Deliverable 1: `backend/src/services/pdfGenerationService.js` (Puppeteer)
Please provide the complete, robust Puppeteer service:
- Initializes a headless Chromium browser instance (handling `--no-sandbox`, `--disable-setuid-sandbox` for Windows/Linux container safety).
- Function `generatePdfFromHtml(htmlContent, options)`: Compiles HTML/CSS into an A4 buffer with header/footer page numbers (`Page X of Y`).
- Function `generateInvoicePdf(invoiceData)`: Pre-built HTML template with ORAC letterhead, client details, line items table, subtotal, VAT 15%, total in USD, banking instructions, and QR verification stamp.
- Robust error handling: Closes the browser or page instance even if rendering throws an exception.

### Deliverable 2: `backend/src/services/docxReportService.js` (`docx` library)
Please provide the Word document generation service:
- Function `generatePlantSurveyReportDocx(surveyData)`: Generates a `.docx` file containing:
  - Title Page: ORAC Industrial Services, Mining Client Name (e.g. Zimplats Ngezi), Asset ID (e.g. Conveyor CV-04), Date, Lead Engineer.
  - Section 1: Executive Summary & Risk Rating (Critical, Major, Minor).
  - Section 2: Visual Inspection & Thickness Gauging Data Table (Pulleys, Belt, Chute Liners).
  - Section 3: Recommended Scope of Work & Bill of Quantities (BOQ).
  - Section 4: Engineering Sign-off & Client Acceptance Signatures.
- Returns a `Buffer` ready to be streamed to the client via `res.send()` with correct MIME headers (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`).

### Deliverable 3: `backend/src/services/googleAuthService.js` (`passport-google-oauth20`)
Please provide the Passport Google strategy configuration:
- Setup for `passport.use(new GoogleStrategy(...))` using environment variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`.
- User verification: Validates if email belongs to an active client contact in ORAC; auto-maps to `ROLE_CLIENT` if whitelisted, or returns an unauthorized status if not authorized.

Please output the complete, tested source code for these 3 services ready to be pasted directly into ORAC!
