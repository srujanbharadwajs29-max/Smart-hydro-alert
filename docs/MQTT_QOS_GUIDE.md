# MQTT Quality of Service (QoS) Laboratory Guide

## 1. Overview of MQTT QoS Levels

MQTT defines three Quality of Service levels per published message and subscription grant:

### QoS 0 — At Most Once ("Fire and Forget")
```text
Publisher  -------- PUBLISH (QoS=0) -------->  Broker
```
- **Control Packets:** 1 (`PUBLISH`).
- **Guarantee:** Message is delivered at most once, relying solely on the underlying TCP connection. No MQTT-level acknowledgement is sent.
- **Trade-off:** Minimum latency and packet overhead; suitable for high-frequency non-critical telemetry where occasional loss is acceptable.

### QoS 1 — At Least Once
```text
Publisher  -------- PUBLISH (QoS=1, PacketID=N) -------->  Broker
Publisher  <------- PUBACK  (PacketID=N)        ---------  Broker
```
- **Control Packets:** 2 (`PUBLISH`, `PUBACK`).
- **Guarantee:** Publisher retains the message until `PUBACK` arrives. If the acknowledgement is delayed or lost, the publisher retransmits with `DUP=1`.
- **Trade-off:** Guarantees delivery across transient drops, **but duplicates can occur**—requiring idempotent backend processing.

### QoS 2 — Exactly Once (at MQTT Protocol Delivery Level)
```text
Publisher  -------- PUBLISH (QoS=2, PacketID=N) -------->  Broker
Publisher  <------- PUBREC  (PacketID=N)        ---------  Broker
Publisher  -------- PUBREL  (PacketID=N)        -------->  Broker
Publisher  <------- PUBCOMP (PacketID=N)        ---------  Broker
```
- **Control Packets:** 4 (`PUBLISH`, `PUBREC`, `PUBREL`, `PUBCOMP`).
- **Guarantee:** Four-way handshake prevents duplicate deliveries between publisher and broker (and independently between broker and subscriber).
- **Trade-off:** Highest network round-trip latency and state overhead (two full RTTs per hop).

## 2. Critical Computer Networks Distinction: Protocol vs. Application Guarantees

> **Important Academic Principle:** MQTT QoS 2 guarantees *exactly-once delivery at the MQTT protocol layer* between a client and broker session. It does **not** automatically guarantee end-to-end exactly-once business processing across arbitrary backend crashes, database transaction rollbacks, or network partitions after the MQTT client library acknowledges `PUBCOMP`. True end-to-end deduplication still requires application-level idempotency keys (such as `messageId` unique constraints).

## 3. Running Experiments in the QoS Laboratory

1. Open **MQTT QoS Lab** in the dashboard.
2. Select **Message Count** (e.g., `30`) and click **Run 0/1/2** to execute sequential real-TCP benchmarks for QoS 0, QoS 1, and QoS 2.
3. Observe how **Avg Broker ACK (ms)** scales from QoS 0 (fastest, no broker ACK wait) → QoS 1 (1 RTT for `PUBACK`) → QoS 2 (2 RTTs for `PUBREC`/`PUBREL`/`PUBCOMP`).
4. Enable **Simulate unacknowledged retransmit** on QoS 1 to observe live duplicate detection (`duplicateCount > 0`), and contrast with QoS 2 (`duplicateCount == 0`).
5. Set **Simulated Drop %** to `20%` and compare QoS 0 (`failedCount > 0`, permanent loss) against QoS 1/2 (retransmission recovery).
