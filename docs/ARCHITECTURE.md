# System Architecture — Virtual Smart Hydro Alert Network

## 1. Problem Statement & Objectives

Water distribution wastage and hidden leaks in multi-floor buildings are difficult to monitor without real-time telemetry. For Computer Networks education, demonstrating IoT publish/subscribe protocols typically requires physical ESP32 microcontrollers and flow sensors.

**Objective:** Build a completely software-based, real-networked IoT telemetry platform where every virtual sensor communicates over genuine TCP sockets using MQTT 3.1.1, allowing students to inspect live protocol behavior, Quality of Service guarantees, Last Will & Testament failure detection, and real-time analytics on a single laptop.

## 2. End-to-End Architecture Diagram

```text
+----------------------------------+
|     VIRTUAL WATER DEVICES        |  (5–50 independent mqtt.js TCP clients)
|  Main Tank · Floor 1 · Floor 2   |  Each client: own TCP socket, keepalive,
|  Floor 3   · Floor 4 · Custom    |  LWT on .../status, QoS 0/1/2 PUBLISH
+----------------+-----------------+
                 |  TCP / MQTT 3.1.1 (Port 1883)
                 v
+----------------------------------+
|        MQTT 3.1.1 BROKER         |  Embedded Aedes TCP broker (default)
|     (127.0.0.1:1883 loopback)    |  or external Eclipse Mosquitto
+----------------+-----------------+
                 |  MQTT Subscription: hydro/+/+/+/+ (QoS 2)
                 v
+----------------------------------+
|    BACKEND NETWORK ENGINE        |  Express HTTP API + MQTT Subscriber
|  - Water Intelligence (6 states) |  - Monotonic clock latency measurement
|  - Heartbeat Silent Detector     |  - QoS 0/1/2 Benchmark Lab Runner
+--------+---------------+---------+
         |               |
         | SQL           | WebSocket Push (/ws)
         v               v
+----------------+  +----------------------------------+
| SQLITE DB      |  |    REACT OPERATIONS DASHBOARD    |
| (node:sqlite)  |  |  10 interactive monitoring views |
| WAL + Pruning  |  |  Recharts + Live SVG Topology    |
+----------------+  +----------------------------------+
```

## 3. Data Flow Lifecycle

1. **Virtual Sensor Generation:** Each virtual device timer generates software-simulated `{ flowRate, presenceDetected, waterDetected }` samples based on its active scenario (`NORMAL_IDLE` through `CRITICAL_LEAKAGE`).
2. **Real MQTT Publish:** The virtual device records a high-resolution monotonic timestamp (`process.hrtime.bigint()`) and sends an actual MQTT `PUBLISH` frame over loopback TCP to the broker on `hydro/building1/<zone>/<deviceId>/sensor`.
3. **Broker Acknowledgement:** For QoS 1 (`PUBACK`) and QoS 2 (`PUBREC`→`PUBREL`→`PUBCOMP`), the client measures **Broker Acknowledgement Time** upon receiving completion from the broker.
4. **Backend Subscription & Processing:** `hydro-backend-subscriber` receives the MQTT packet, computes **Backend Receipt Time** using the shared host monotonic clock, evaluates the 6-state Water Intelligence Engine, commits telemetry and alerts to SQLite via parameterized queries, and measures **Backend Processing Time**.
5. **Alert Publication & WebSocket Broadcast:** Abnormal state transitions publish an alert payload to `hydro/building1/<zone>/<deviceId>/alert` and push delta frames over WebSocket (`/ws`) to all connected React dashboards.

## 4. Database Schema & Retention

Stored in `data/hydro_network.db` (WAL mode):
- `devices`: Persisted virtual device inventory and cumulative water consumption/wastage.
- `sensor_readings`: Time-series sensor packets with separated latency fields (pruned to latest 1,500 rows).
- `water_alerts`: Escalated `WARNING`, `ALERT`, `LEAK`, `CRITICAL` records with acknowledgement state (latest 500 rows).
- `mqtt_events`: Real broker/subscriber protocol audit trail (`CONNECT`, `SUBSCRIBE`, `PUBLISH`, `LWT`, `DISCONNECT`, `ERROR`) (latest 1,500 rows).
- `network_events`: Failure injection and recovery audit log including failure timestamp, detection method, and downtime duration (latest 500 rows).
- `qos_experiments`: Completed QoS 0/1/2 benchmark runs.
- `settings`: Configurable Water Intelligence thresholds and heartbeat timeouts.

## 5. Limitations & Future Scope

- **Single-Host Loopback:** All TCP sockets run on `127.0.0.1`; therefore measured latencies reflect OS loopback stack and protocol handshake overhead rather than WAN wireless jitter.
- **Software Telemetry:** Water flow and moisture readings are software-simulated rather than sourced from physical Hall-effect flow sensors.
- **Future Scope:** TLS/mTLS (MQTTS port 8883) certificate lab, MQTT 5.0 reason codes and shared subscriptions, and multi-laptop LAN broker clustering.
