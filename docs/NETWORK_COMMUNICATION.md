# Network Communication & MQTT Protocol Design

## 1. Protocol Stack

| OSI / TCP-IP Layer | Protocol Used | Role in Virtual Smart Hydro Alert Network |
| --- | --- | --- |
| Application | MQTT 3.1.1 | Lightweight publish/subscribe telemetry between virtual sensors and backend |
| Application | HTTP/1.1 (REST) | Control plane APIs (device management, fault injection, QoS tests, settings) |
| Application | WebSocket (RFC 6455) | Full-duplex real-time push from backend to React dashboard (`/ws`) |
| Transport | TCP | Reliable, ordered byte-stream transport for MQTT (`:1883`) and HTTP/WS (`:3000`) |
| Network | IPv4 Loopback (`127.0.0.1`) | Local virtual network routing suitable for single-laptop demonstration |

## 2. MQTT Topic Hierarchy

Every virtual device publishes into a deterministic, multi-level topic tree:

```text
hydro/building1/<zone>/<deviceId>/sensor   # Telemetry JSON (flow, presence, moisture, monotonic clock)
hydro/building1/<zone>/<deviceId>/status   # Retained ONLINE / STOPPED / LWT OFFLINE lifecycle events
hydro/building1/<zone>/<deviceId>/alert    # Backend-emitted abnormal water state alerts
hydro/qos/lab/<runId>                      # Isolated QoS 0/1/2 benchmark test channels
```

### Default Device Topics

| Device Name | Client ID | Sensor Topic |
| --- | --- | --- |
| Main Tank Device | `hydro-virt-device00` | `hydro/building1/main-tank/device00/sensor` |
| Floor 1 Device | `hydro-virt-device01` | `hydro/building1/floor1/device01/sensor` |
| Floor 2 Device | `hydro-virt-device02` | `hydro/building1/floor2/device02/sensor` |
| Floor 3 Device | `hydro-virt-device03` | `hydro/building1/floor3/device03/sensor` |
| Floor 4 Device | `hydro-virt-device04` | `hydro/building1/floor4/device04/sensor` |

### Wildcard Subscription

The backend subscriber (`hydro-backend-subscriber`) subscribes to:
```text
hydro/+/+/+/+   (QoS 2)
```
Single-level wildcards (`+`) match building, zone, device ID, and channel (`sensor`, `status`, `alert`) without accidentally consuming internal `$SYS/#` or QoS lab traffic.

## 3. Sensor Message JSON Schema

```json
{
  "messageId": "msg-device01-a91f02",
  "deviceId": "device01",
  "deviceName": "Floor 1 Device",
  "location": "Building 1 · Floor 1 Utility Wing",
  "flowRate": 5.42,
  "presenceDetected": true,
  "waterDetected": false,
  "unattendedFlowSeconds": 0,
  "intervalMs": 2500,
  "qos": 1,
  "publishedAtIso": "2026-11-21T10:15:30.112Z",
  "hrPublishNs": "14829104829100",
  "softwareGenerated": true
}
```

## 4. Latency Measurement Methodology

Wall clocks (`Date.now()`) can skew or jump during NTP adjustments. This platform uses Node.js's monotonic nanosecond clock (`process.hrtime.bigint()`) on the shared host and strictly separates three metrics:

1. **Client Publish → Broker ACK Time (`brokerAckMs`):** Time from `client.publish()` invocation until the MQTT broker confirms completion (`PUBACK` for QoS 1, `PUBCOMP` for QoS 2, or socket write for QoS 0).
2. **Client Publish → Backend Receipt Time (`backendReceiptMs`):** Monotonic delta from client publish to `hydro-backend-subscriber` receiving the message via TCP from the broker.
3. **Backend Processing Time (`backendProcessMs`):** Time spent inside the backend evaluating the Water Intelligence state machine and committing the record to SQLite.
