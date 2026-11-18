# HARVEST PACKET FOR DASH AI CHAT
*(Copy everything below this line and paste it into your Dash AI conversation)*

---

Hello Dash AI Agent! In **ORAC Industrial ERP**, we are connecting Virtual Technical Surveys (video consultations between mining plant engineers and ORAC rubber lining specialists) to our **commercial quotation engine**.

When a technical survey concludes, we want the meeting audio or transcript to **automatically extract equipment wear scope and draft pre-populated quotation lines** with zero manual re-typing.

We want to harvest your audio processing, Whisper transcription, and structured prompt engineering pipeline from `Dash AI` (`app.py` & prompt extraction).

### What ORAC Needs for Sprint 4 (AI Meeting Scope Extraction):
1. **Service (`backend/src/services/meetingAiService.js`):**
   - Transcribes recorded meeting audio (via Whisper / Groq API / local pipeline).
   - Prompts the LLM with strict few-shot extraction rules to parse technical discussion into an industrial scope object:
     - `equipment_tag`: Slurry Pump PU-001 / Conveyor Pulley / Flotation Tank
     - `wear_measurement`: e.g. "Steel shell worn to 4mm, original 12mm"
     - `recommended_service`: Cold vulcanized rubber relining / ceramic tiling / hot splice
     - `line_items`: Array of `{ description, quantity, unit, estimated_unit_cost, recommended_rate }`
   - Enforces 100% schema compliance against ORAC's `CreateQuoteSchema`.
   - Includes deterministic mock fallback for offline automated testing.
2. **Quotation Linkage Handler:**
   - Automatically links the extracted scope to create a `Draft` quotation in ORAC's `quotes` collection.
3. **Automated Test Suite (`backend/tests/meetingAiScopeExtractor.test.js`):**
   - Native Node.js test runner (`import test from 'node:test'`, `import assert from 'node:assert'`).
   - Tests audio/text input, JSON extraction, schema validation, and draft quote creation.

---

### REFERENCE CONTEXT FROM ORAC MASTER TRACKER:

#### Subsystem 10: Virtual Technical Surveys & AI Minutes (Target: 100%)
| Item | Target Status | Notes & Specifications |
| :--- | :--- | :--- |
| Real-Time Audio Transcription | DONE | Harvest from Dash AI audio processing pipeline. |
| AI Minutes & Scope Extractor | DONE | LLM prompt pipeline extracts equipment wear tags and quotation line items. |
| Auto-Quotation Draft Linkage | DONE | Extracted scope automatically creates a pre-populated draft in ORAC `quotes`. |

Please generate the complete, self-contained code blocks now!
