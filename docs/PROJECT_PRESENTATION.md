# Academic Presentation Outline & Live Demo Script

**Project Title:** Virtual Smart Hydro Alert Network: Real-Time Water Monitoring and Alert System Using MQTT  
**Target Course:** 5th-Semester Computer Science & Engineering — Computer Networks Mini-Project

---

## Slide Deck Structure (10 Slides)

1. **Title Slide:** Project title, team members, course, and attribution to `momo840505/smart-hydro-alert`.
2. **Problem Statement:** Detecting water wastage and pipe leaks across multi-floor buildings in real time without expensive physical sensor testbeds.
3. **Objectives:** 100% virtual, real-TCP MQTT architecture; preserve 6 water states; add QoS 0/1/2 benchmarking, LWT failure simulation, live topology, and Wireshark verification.
4. **System Architecture:** Show Virtual Devices → TCP MQTT Broker (`:1883`) → Backend Subscriber & Water Intelligence → SQLite + WebSocket (`/ws`) → React Dashboard.
5. **MQTT Protocol & Topic Hierarchy:** Explain Publish/Subscribe decoupling, wildcard subscription (`hydro/+/+/+/+`), keepalive, and retained status messages.
6. **Water Intelligence Engine (6 States):** Table comparing `NORMAL`, `NORMAL_FLOW`, `WARNING`, `ALERT`, `LEAK`, and `CRITICAL`.
7. **MQTT Quality of Service (QoS 0/1/2):** Diagrams of `PUBLISH`, `PUBACK`, `PUBREC`, `PUBREL`, `PUBCOMP`, plus protocol vs application delivery guarantees.
8. **Fault Tolerance & Failure Detection:** Contrast LWT (abrupt TCP drop) vs Heartbeat Timeout (silent connected client) vs Broker Outage recovery.
9. **Performance Measurement & Wireshark Proof:** Monotonic clock latency separation (`Broker ACK` vs `Backend Receipt` vs `Backend Process`) + real Wireshark loopback capture screenshot.
10. **Conclusion, Limitations & Future Scope:** Summary of automated tests, single-host loopback limits, and MQTTS/TLS roadmap.

---

## 5-Minute Live Demonstration Script

1. **Overview & Topology (45s):** Open *Overview Dashboard*, then *Network Topology*. Show 5 default virtual devices streaming real MQTT packets over TCP `:1883` with animated active links.
2. **Water Intelligence 6-State Demo (60s):** Open *Water Monitoring*, select *Floor 1 Device*, and click **Water Contact (No Flow)** (`LEAK`) followed by **Critical Leakage Condition** (`CRITICAL`). Show immediate MQTT alert delivery and entry in *Alert History*.
3. **Virtual Device Scaling (30s):** Open *Virtual Device Lab* and dynamically add **Floor 5 Device (QoS 2)**. Show it immediately connecting in *MQTT Center* and appearing in *Network Topology*.
4. **QoS 0/1/2 Lab (60s):** Open *MQTT QoS Lab*, run **Run 0/1/2** (25 messages), and point out the bar chart contrasting Broker ACK and Subscriber Delivery latencies plus QoS 1 duplicate detection vs QoS 2 zero duplicates.
5. **Network Failure & LWT Demo (75s):** Open *Failure Simulator*, click **Abrupt Disconnect (Trigger LWT)** on Floor 2, then **Stop Publishing (Silent Mode)** on Floor 3, and briefly trigger a **5s Broker Outage**. Conclude with **Restore All Communication** and inspect the downtime calculations in the audit log.
