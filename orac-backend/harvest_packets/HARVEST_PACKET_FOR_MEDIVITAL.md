# HARVEST PACKET FOR MEDIVITAL CHAT
*(Copy everything below this line and paste it into your MediVital conversation)*

---

Hello MediVital Agent! We are integrating **Subsystem 10: Virtual Technical Surveys** into the **ORAC Industrial ERP** system.

In our industrial business (rubber lining, conveyor splicing, pump relining), mining plant engineers (at Zimplats, Unki, Mimosa) need to book video consultation surveys with ORAC technical specialists to inspect worn equipment, review CAD drawings, and assess relining scope before sending crews to site.

We want to harvest your battle-tested **Daily.co WebRTC video room integration** from `MediVital/api/services/videoService.js` and `MediVital/api/controllers/appointment.controller.js`.

### What ORAC Needs for Sprint 4 (Virtual Technical Surveys):
1. **Service (`backend/src/services/videoMeetingService.js`):**
   - Provisions Daily.co WebRTC rooms via REST API (`https://api.daily.co/v1/rooms`).
   - Configures 60-minute meeting expiration, screen sharing enabled (for CAD plant drawings), and privacy controls.
   - Generates secure meeting tokens for participants (Plant Engineer + ORAC Technical Lead).
   - Includes mock fallback when `DAILY_API_KEY` is not set so automated tests pass locally with zero cost.
2. **Controller (`backend/src/controllers/videoSurveyController.js`):**
   - `POST /api/surveys/book`: Schedules a survey appointment linked to an ORAC `client_id` and `equipment_tag_id`.
   - `GET /api/surveys/:id/room`: Retrieves/generates the Daily.co room URL and token.
   - `POST /api/surveys/:id/notes`: Stores engineer observations, wear measurements (mm), and recommended lining specs.
3. **Frontend Component (`src/components/video/DailyVideoRoom.jsx`):**
   - React component wrapping `@daily-co/daily-js` iframe or custom call object.
   - Camera/Mic controls, screen share button, participant grid, and "Leave Survey" button.
4. **Automated Test Suite (`backend/tests/virtualSurveyMeeting.test.js`):**
   - Native Node.js test runner (`import test from 'node:test'`, `import assert from 'node:assert'`).
   - Tests survey booking, Daily room creation, token generation, and note attachment.

---

### REFERENCE CONTEXT FROM ORAC MASTER TRACKER:

#### Subsystem 10: Virtual Technical Surveys & AI Minutes (Target: 100%)
| Item | Target Status | Notes & Specifications |
| :--- | :--- | :--- |
| Survey Appointment Booking | DONE | Harvest from `MediVital/api/controllers/appointment.controller.js`. |
| Embedded Video Meeting Rooms | DONE | Harvest from `MediVital/api/services/videoService.js` (Daily.co WebRTC). |
| Equipment Tag Linkage | DONE | Survey session explicitly tags the mining equipment (e.g. `TAG-PU-001`). |

Please generate the complete, self-contained code blocks now!
