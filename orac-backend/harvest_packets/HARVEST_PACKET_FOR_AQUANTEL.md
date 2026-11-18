# HARVEST PACKET FOR AQUANTEL CHAT
*(Copy everything below this line and paste it into your Aquantel conversation)*

---

Hello Aquantel Agent! We are integrating **Subsystem 12: Plant IoT Telemetry & Condition Monitoring** into the **ORAC Industrial ERP** system.

In our industrial business, ORAC manages slurry pumps, cyclones, and conveyor pulleys relined with wear-resistant rubber and ceramics at major mining operations (Zimplats, Unki, Mimosa). We want to ingest live IoT sensor telemetry from pump bearings, drive motors, and casing wear plates directly into ORAC.

We want to harvest your **IoT sensor ingestion, time-series telemetry processing, and threshold alert logic** from `aquantel`.

### What ORAC Needs for Sprint 6 (Plant IoT Telemetry):
1. **Service (`backend/src/services/iotTelemetryService.js`):**
   - Ingests telemetry payloads: `{ sensor_id, equipment_tag_id, timestamp, metrics: { vibration_rms_mms, bearing_temp_celsius, casing_wear_depth_mm, pump_flow_rate_m3h } }`.
   - Threshold Monitoring:
     - Warning threshold: vibration $> 4.5\text{ mm/s}$ or temp $> 75^\circ\text{C}$.
     - Critical threshold: vibration $> 7.1\text{ mm/s}$ or temp $> 90^\circ\text{C}$.
   - **Predictive Maintenance Trigger:** Critical wear depth automatically triggers a pre-populated draft quotation in ORAC `quotes` for pre-emptive rubber relining before catastrophic plant failure!
2. **Controller (`backend/src/controllers/telemetryController.js`):**
   - `POST /api/telemetry/ingest`: Secure webhook for industrial IoT gateway devices.
   - `GET /api/telemetry/equipment/:tagId`: Retrieves 30-day historical trend data for condition monitoring charts.
3. **Automated Test Suite (`backend/tests/iotTelemetry.test.js`):**
   - Native Node.js test runner (`import test from 'node:test'`, `import assert from 'node:assert'`).
   - Tests telemetry ingestion, anomaly detection, threshold alert generation, and automatic quote draft creation.

---

### REFERENCE CONTEXT FROM ORAC MASTER TRACKER:

#### Subsystem 12: Plant IoT Telemetry & Condition Monitoring (Target: 100%)
| Item | Target Status | Notes & Specifications |
| :--- | :--- | :--- |
| Equipment Sensor Ingestion | DONE | Harvest from `aquantel` (firmware/hardware telemetry microservice). |
| Live Wear & Vibration Telemetry | DONE | Ingests sensor data linked to ORAC's `equipment_tags`. |
| Predictive Maintenance Trigger | DONE | High-wear threshold automatically generates pre-emptive quotation draft. |

Please generate the complete, self-contained code blocks now!
