# Virtual Smart Hydro Alert Network: Real-Time Water Monitoring and Alert System Using MQTT

A completely virtual, software-based Computer Networks academic platform that demonstrates real-time IoT water monitoring, multi-client MQTT 3.1.1 publish/subscribe communication over local TCP sockets, MQTT QoS 0/1/2 protocol analysis, Last Will & Testament (LWT), network failure injection, live architecture topology visualization, and persistent telemetry analytics—requiring **zero physical hardware**.

---

## Attribution & Reference Project Audit

- **Original Reference Project:** [momo840505/smart-hydro-alert](https://github.com/momo840505/smart-hydro-alert)
- **Preserved Core Domain Logic:** All six original water monitoring states (`NORMAL`, `NORMAL_FLOW`, `WARNING`, `ALERT`, `LEAK`, `CRITICAL`) and their detection semantics are retained and expanded with configurable thresholds and repeatable software simulation scenarios.
- **Workspace Audit & Architecture Upgrade:** Because this environment runs a self-contained Node.js 22 + TypeScript + Express + React + Vite runtime without local `mosquitto` or `mongod` daemons installed, the upgraded platform implements:
  - **Real Embedded TCP MQTT 3.1.1 Broker (`aedes`)** listening on TCP port `1883` (with automatic fallback if busy, plus optional `MQTT_BROKER_MODE=external` support to connect directly to an external **Eclipse Mosquitto** broker!).
  - **Independent Virtual MQTT Clients (`mqtt`)** — 5 default devices (`Main Tank Device`, `Floor 1–4 Devices`) scalable to 20–50 virtual clients, each maintaining its own TCP socket, keepalive, and MQTT Last Will & Testament (LWT).
  - **Real Persistent SQLite Database** using Node 22's built-in `node:sqlite` (`data/hydro_network.db`) with parameterized queries and automatic retention pruning.
  - **Real WebSocket Streaming (`ws`)** pushing delta updates to a 10-page React + Recharts Network Operations Dashboard.

---

## Core Modules

1. **Overview Dashboard:** Live active/offline device counts, aggregate water flow, total alerts, MQTT message rate, broker availability, and recent network incidents.
2. **Water Monitoring (Water Intelligence Engine):** Preserves `NORMAL`, `NORMAL_FLOW`, `WARNING`, `ALERT`, `LEAK`, and `CRITICAL` states with one-click repeatable scenarios and explicit software-generated labeling.
3. **Virtual Device Lab:** Provision 5–50 virtual water sensors, configure per-device QoS (0/1/2) and publish intervals, and control start/stop/restart/reset/normal/abnormal states.
4. **MQTT Communication Center:** Real broker connection counters, active publishers/subscribers, live `hydro/building1/<zone>/<deviceId>/sensor|status|alert` topic tree, and JSON payload inspector.
5. **MQTT QoS Laboratory:** Live TCP benchmark runner for QoS 0, QoS 1, and QoS 2 measuring Broker ACK vs Subscriber Delivery latency, failures, and duplicate deliveries, with protocol diagrams (`PUBLISH`, `PUBACK`, `PUBREC`, `PUBREL`, `PUBCOMP`).
6. **Network Analytics:** Historical throughput, message rate, client connectivity, and clearly separated latency layers (Broker ACK time, Backend Receipt time, Backend Processing time) measured with monotonic `process.hrtime.bigint()` clocks.
7. **Live Network Topology:** Interactive SVG architecture diagram reflecting live socket/broker/backend/DB/WebSocket state and animated message pulses.
8. **Network Failure Simulator:** Abrupt TCP drops triggering real MQTT LWT, multi-device outages, silent-publisher heartbeat timeout detection (distinct from MQTT disconnect), real embedded broker outages, simulated client publish delay, and simulated transport packet drops.
9. **Alert History:** Filterable, searchable alert ledger with acknowledgement tracking and CSV export.
10. **System Settings & Wireshark Guide:** Live threshold tuning, theme switcher (dark/light), history pruning, and verified Wireshark loopback display filters.

---

## Windows PowerShell Execution Guide (Single Student Laptop)

### Option A: Zero-Dependency Local Run (Embedded TCP MQTT Broker + SQLite)

```powershell
# 1. Environment setup
Copy-Item .env.example .env

# 2. Install dependencies
npm install

# 3. Start full-stack server (Embedded MQTT Broker on TCP :1883 + Express/WS/React on :3000)
npm run dev

# 4. Open Dashboard in browser
Start-Process "http://localhost:3000"

# 5. Run automated unit + real TCP MQTT integration tests (in a second PowerShell window)
npm test

# 6. Build frontend for production
npm run build

# 7. Stop server
# Press Ctrl + C in the PowerShell terminal for graceful shutdown
```

### Option B: Using External Eclipse Mosquitto (Docker Compose or Native Windows Service)

```powershell
# Start Eclipse Mosquitto via Docker (optional)
docker run -d --name hydro-mosquitto -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf

# Or start native Windows Mosquitto service (if installed)
Start-Service mosquitto

# Configure .env to point to external Mosquitto
$env:MQTT_BROKER_MODE="external"
$env:MQTT_BROKER_URL="mqtt://127.0.0.1:1883"
npm run dev

# Stop external Mosquitto container when finished
docker stop hydro-mosquitto; docker rm hydro-mosquitto
```

---

## Documentation Suite

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design, data flow, and component responsibilities
- [docs/NETWORK_COMMUNICATION.md](docs/NETWORK_COMMUNICATION.md) — TCP/MQTT/WebSocket protocol stack & topic hierarchy
- [docs/MQTT_QOS_GUIDE.md](docs/MQTT_QOS_GUIDE.md) — QoS 0/1/2 handshake mechanics & delivery vs application guarantees
- [docs/NETWORK_FAILURE_TESTING.md](docs/NETWORK_FAILURE_TESTING.md) — LWT, silent publishers, broker outage & recovery testing
- [docs/WIRESHARK_GUIDE.md](docs/WIRESHARK_GUIDE.md) — Step-by-step Windows loopback packet capture & verified display filters
- [docs/PROJECT_PRESENTATION.md](docs/PROJECT_PRESENTATION.md) — Academic presentation outline & live demo script
- [docs/VIVA_QUESTIONS.md](docs/VIVA_QUESTIONS.md) — 5th-semester Computer Networks viva Q&A bank


---
## 🌐 Live Demo

🚀 **Try the project here:** 
[Virtual Smart Hydro Alert Network](smart-hydro-alert.vercel.app)
