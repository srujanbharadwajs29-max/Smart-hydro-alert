# Wireshark Loopback Packet Analysis Guide (Windows)

> **Transparency Note:** The web application does **not** capture raw packets inside the browser. Wireshark runs independently on the host OS to inspect the genuine TCP and MQTT 3.1.1 frames exchanged between the virtual clients and the local broker on `127.0.0.1:1883`.

---

## 1. Prerequisites on Windows

1. Install **Wireshark** (4.x recommended).
2. During installation, ensure **Npcap** is installed with **"Support loopback traffic ('Npcap Loopback Adapter')"** checked.
3. Start the Virtual Smart Hydro Alert Network (`npm run dev`), confirming the console reports:
   `[MQTT Broker] Embedded Aedes TCP MQTT 3.1.1 active on 127.0.0.1:1883`

## 2. Starting a Loopback Capture

1. Open **Wireshark**.
2. In the interface list, double-click **Adapter for loopback traffic capture**.
3. Wait 5–10 seconds (or trigger a QoS 2 test / device restart in the dashboard) so packets accumulate.
4. Click the red **Stop** icon when ready to analyze.

## 3. Verified Wireshark Display Filters

| Network Concept to Demonstrate | Verified Wireshark Display Filter | What Students Should Point Out |
| --- | --- | --- |
| **All MQTT Traffic on Broker Port** | `tcp.port == 1883 && mqtt` | Decoded MQTT protocol frames over loopback TCP |
| **TCP 3-Way Handshake** | `tcp.port == 1883 && (tcp.flags.syn == 1)` | `SYN` → `SYN, ACK` → `ACK` establishing client socket |
| **MQTT CONNECT & CONNACK** | `mqtt.msgtype == 1 \|\| mqtt.msgtype == 2` | Client ID, Clean Session flag, Keepalive (10s), Will Topic/Payload (LWT), Return Code `0x00` |
| **MQTT SUBSCRIBE & SUBACK** | `mqtt.msgtype == 8 \|\| mqtt.msgtype == 9` | `hydro-backend-subscriber` subscribing to `hydro/+/+/+/+` with Granted QoS 2 |
| **MQTT PUBLISH (QoS 0 / 1 / 2)** | `mqtt.msgtype == 3` | Topic name (`hydro/building1/.../sensor`), QoS bits, JSON payload bytes |
| **QoS 1 Acknowledgement (`PUBACK`)** | `mqtt.msgtype == 3 \|\| mqtt.msgtype == 4` | Matching Packet Identifier between `PUBLISH (QoS=1)` and `PUBACK` |
| **QoS 2 4-Way Exchange** | `mqtt.msgtype in {3, 5, 6, 7}` | Full `PUBLISH (QoS=2)` → `PUBREC` → `PUBREL` → `PUBCOMP` sequence |
| **Keepalive Heartbeat** | `mqtt.msgtype == 12 \|\| mqtt.msgtype == 13` | `PINGREQ` / `PINGRESP` maintaining idle sessions (visible during Silent Mode!) |
| **MQTT Graceful Disconnect** | `mqtt.msgtype == 14` | `DISCONNECT` packet sent when clicking **Stop** (vs missing on **Abrupt Disconnect**) |
| **TCP Connection Termination** | `tcp.port == 1883 && (tcp.flags.fin == 1 \|\| tcp.flags.reset == 1)` | Graceful `FIN/ACK` vs abrupt `RST` socket teardown triggering LWT |

## 4. Recommended Live Viva Packet Demo

1. Start Wireshark loopback capture with filter: `tcp.port == 1883 && mqtt`.
2. In the dashboard **MQTT QoS Lab**, run **QoS 2** with **5 messages**.
3. Show the examiner the exact four-frame sequence (`PUBLISH`, `PUBREC`, `PUBREL`, `PUBCOMP`) with identical Packet Identifiers.
4. In the **Failure Simulator**, click **Abrupt Disconnect (Trigger LWT)** on Floor 2 Device.
5. Clear `&& mqtt` to `tcp.port == 1883` and show the TCP `RST` followed immediately by the broker publishing the retained `LWT_UNEXPECTED_DISCONNECT` JSON to `hydro/building1/floor2/device02/status`.
