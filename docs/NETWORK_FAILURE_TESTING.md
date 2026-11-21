# Network Failure Simulation & Resilience Testing Guide

All failure scenarios in the **Network Failure Simulator** operate on real TCP sockets, MQTT sessions, and client publish loops—never fake frontend status toggles.

## 1. Failure Modes & Detection Mechanisms

| Scenario | What Actually Happens on the Network | Detection Mechanism | Expected Dashboard State |
| --- | --- | --- | --- |
| **Abrupt Device Disconnect** | Underlying TCP `net.Socket` is destroyed (`stream.destroy()`) without sending MQTT `DISCONNECT` | Broker immediately publishes client's **Last Will & Testament (LWT)** on `.../status` (`QoS 1`, retained) | Device turns `DISCONNECTED`; `DEVICE_LWT_TRIGGERED` logged |
| **Multi-Device Outage** | 3 virtual MQTT TCP sockets abruptly dropped simultaneously | Concurrent broker LWT publications + disconnect events | Multiple red links in Live Topology; offline count spikes |
| **Stop Publishing (Silent Mode)** | Client remains TCP/MQTT connected (TCP ACKs & `PINGREQ`/`PINGRESP` continue), but sensor `PUBLISH` loop pauses | Backend **Heartbeat / Last-Seen Monitor** detects missing telemetry past `heartbeatTimeoutSec` | Device turns `SILENT` (amber) — explicitly distinguished from `DISCONNECTED` |
| **Broker Interruption** | Embedded TCP listener on `:1883` closes and terminates all client sockets | Broker status becomes `INTERRUPTED`; all virtual clients enter `RECONNECTING` with backoff | Topology highlights broken broker; availability % decreases |
| **Delayed Publishing** | Client delays outgoing `PUBLISH` by configurable ms | Higher inter-arrival interval visible in Analytics | Clearly labeled as client-side simulated delay |
| **Simulated Packet Loss** | Virtual client drops configured % of outgoing sensor publishes before socket transmission | `messagesDropped` counter increments per device | Clearly labeled as simulated client-side drop |
| **Restore All Communication** | Broker restarts TCP listener, impairments clear, disconnected clients reconnect | `CONNECT`/`CONNACK` + `ONLINE` status message + downtime calculated | `BROKER_RESTORED` & `DEVICE_RECONNECTED` logged with exact downtime |

## 2. Step-by-Step Classroom Demonstration

1. Open **Network Topology** in one window (or switch tabs after triggering) and **Failure Simulator** in the main panel.
2. Select **Floor 2 Device** and click **Abrupt Disconnect (Trigger LWT)**.
   - Immediately check the **Failure & Recovery Audit Log**: you will see `DEVICE_LWT_TRIGGERED` with detection method `LWT`.
3. Select **Floor 3 Device** and click **Stop Publishing (Silent Mode)**.
   - Point out to evaluators that the MQTT client is *still listed as connected* in the MQTT Communication Center, yet after `heartbeatTimeoutSec` (default 12s) the backend flags it as **SILENT (No Data)** via `HEARTBEAT_TIMEOUT`.
4. Click **Simulate 8s Broker Outage**.
   - Observe all virtual devices enter `RECONNECTING`, broker availability drop below 100%, and automatic reconnection once the TCP listener comes back online.
5. Click **Restore All Communication** to bring every node cleanly back to `CONNECTED`.
