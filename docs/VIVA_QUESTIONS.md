# Computer Networks Viva Voce Question Bank

1. **Why use MQTT instead of HTTP polling for IoT water sensors?**  
   MQTT uses a persistent TCP connection with a tiny 2-byte fixed header and broker-mediated publish/subscribe routing, eliminating repeated HTTP headers, TCP handshakes, and client polling overhead.

2. **How is each virtual device in this project actually networked?**  
   Each virtual device instantiates its own independent `mqtt` TCP client with a unique `clientId`, separate TCP socket to `127.0.0.1:1883`, independent keepalive timer, and its own Last Will & Testament (LWT).

3. **What is the difference between MQTT QoS 0, QoS 1, and QoS 2?**  
   - **QoS 0:** At most once (`PUBLISH` only, no ACK).  
   - **QoS 1:** At least once (`PUBLISH` → `PUBACK`, retries may duplicate).  
   - **QoS 2:** Exactly once at the MQTT protocol layer (`PUBLISH` → `PUBREC` → `PUBREL` → `PUBCOMP`).

4. **Does MQTT QoS 2 guarantee exactly-once database writes if the backend crashes?**  
   No. QoS 2 guarantees exactly-once delivery across the MQTT protocol hop. End-to-end exactly-once business processing across server crashes or database rollbacks still requires application-level idempotency keys.

5. **How does MQTT Last Will & Testament (LWT) work?**  
   During `CONNECT`, the client registers a Will Topic (`.../status`), Will Payload (`OFFLINE`), and QoS. If the TCP connection drops unexpectedly without an MQTT `DISCONNECT` packet (or keepalive expires), the broker automatically publishes the Will message to notify subscribers.

6. **How do you distinguish an MQTT disconnection from a frozen sensor that stays connected?**  
   An abrupt disconnection triggers broker LWT (`DISCONNECTED`). A frozen sensor that stops sending application telemetry while TCP/keepalive stays alive is detected by our backend **Heartbeat / Last-Seen Monitor**, which flags it as `SILENT` after `heartbeatTimeoutSec`.

7. **Why do we use `process.hrtime.bigint()` instead of `Date.now()` for latency?**  
   Wall clocks (`Date.now()`) can jump backward or forward due to NTP sync. A monotonic high-resolution clock (`hrtime`) increases strictly monotonically, avoiding negative or skewed latency measurements on the same host.

8. **Why do you separate Broker ACK Time, Backend Receipt Time, and Backend Processing Time?**  
   Broker ACK measures protocol handshake round-trip to the broker; Backend Receipt measures broker-to-subscriber forwarding over TCP; Backend Processing isolates Water Intelligence computation and SQLite commit time.

9. **What is the role of the `+` wildcard in `hydro/+/+/+/+`?**  
   `+` is a single-level MQTT topic wildcard matching exactly one hierarchy level (building, zone, device ID, channel), allowing one backend subscriber to receive all device sensor, status, and alert topics without subscribing to unrelated `$SYS/#` or QoS lab topics.

10. **Why is WebSocket used between the backend and React dashboard instead of MQTT or HTTP polling?**  
    WebSocket provides a full-duplex persistent channel over the same HTTP port (`3000`) to push backend-processed state deltas, alerts, and aggregated analytics to browsers immediately without polling overhead or exposing internal broker credentials.

11. **What happens during a simulated broker interruption?**  
    The embedded TCP listener on port `1883` stops and destroys active client sockets. All connected virtual devices and the backend subscriber enter real MQTT reconnect loops and automatically re-establish sessions and subscriptions when the broker restarts.

12. **How do you verify genuine MQTT packets in Wireshark on Windows?**  
    Capture on Npcap's *Adapter for loopback traffic capture* and filter with `tcp.port == 1883 && mqtt` (or `mqtt.msgtype in {3, 5, 6, 7}` for QoS 2 handshakes).
