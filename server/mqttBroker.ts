import { EventEmitter } from 'node:events';
import net from 'node:net';
import { Aedes } from 'aedes';
import type { BrokerStatus, MqttQoS } from '../src/types/hydro.ts';

export interface BrokerPublishInfo {
  clientId: string;
  topic: string;
  qos: MqttQoS;
  retain: boolean;
  payloadSize: number;
  payloadText: string;
}

export class HydroMqttBroker extends EventEmitter {
  private aedes: Aedes | null = null;
  private tcpServer: net.Server | null = null;
  private activeSockets = new Set<net.Socket>();
  private connectedClients = new Set<string>();
  private publisherIds = new Set<string>();
  private subscriptions = new Map<string, Map<string, number>>();
  private status: BrokerStatus['status'] = 'ONLINE';
  private startedAtMs = Date.now();
  private startedAtIso = new Date().toISOString();
  private interruptedAtMs: number | null = null;
  private totalDowntimeMs = 0;
  private autoRestoreTimer: NodeJS.Timeout | null = null;

  public readonly mode: 'embedded' | 'external';
  public host: string;
  public port: number;
  public readonly authEnabled: boolean;
  private readonly username?: string;
  private readonly password?: string;

  constructor(options?: {
    mode?: 'embedded' | 'external';
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  }) {
    super();
    this.mode = options?.mode ?? (process.env.MQTT_BROKER_MODE === 'external' ? 'external' : 'embedded');
    this.host = options?.host ?? '127.0.0.1';
    this.port = options?.port ?? (Number(process.env.MQTT_PORT) || 1883);
    this.username = options?.username ?? (process.env.MQTT_USERNAME || undefined);
    this.password = options?.password ?? (process.env.MQTT_PASSWORD || undefined);
    this.authEnabled = Boolean(this.username && this.password);
  }

  public getBrokerUrl(): string {
    if (this.mode === 'external' && process.env.MQTT_BROKER_URL) {
      return process.env.MQTT_BROKER_URL;
    }
    return `mqtt://${this.host}:${this.port}`;
  }

  public getAuthCredentials(): { username?: string; password?: string } {
    if (!this.authEnabled) return {};
    return { username: this.username, password: this.password };
  }

  public async start(): Promise<void> {
    if (this.mode === 'external') {
      this.status = 'ONLINE';
      this.startedAtMs = Date.now();
      this.startedAtIso = new Date().toISOString();
      return;
    }

    await this.createAedesInstance();
    await this.bindTcpServerWithFallback();
    this.status = 'ONLINE';
    this.startedAtMs = Date.now();
    this.startedAtIso = new Date().toISOString();
  }

  private async createAedesInstance(): Promise<void> {
    if (this.aedes && !this.aedes.closed) {
      await new Promise<void>((resolve) => this.aedes?.close(() => resolve()));
    }

    const broker = await Aedes.createBroker({
      id: 'hydro-aedes-broker',
      heartbeatInterval: 30_000,
      connectTimeout: 15_000,
      authenticate: (_client, username, password, callback) => {
        if (!this.authEnabled) {
          callback(null, true);
          return;
        }
        const passStr = password ? password.toString('utf8') : '';
        if (username === this.username && passStr === this.password) {
          callback(null, true);
        } else {
          const err = Object.assign(new Error('Invalid MQTT credentials'), { returnCode: 4 as const });
          callback(err, false);
        }
      },
    });

    broker.on('client', (client) => {
      this.connectedClients.add(client.id);
      this.emit('clientConnected', client.id);
    });

    broker.on('clientDisconnect', (client) => {
      this.connectedClients.delete(client.id);
      this.subscriptions.delete(client.id);
      this.emit('clientDisconnected', client.id);
    });

    broker.on('subscribe', (subs, client) => {
      let clientMap = this.subscriptions.get(client.id);
      if (!clientMap) {
        clientMap = new Map();
        this.subscriptions.set(client.id, clientMap);
      }
      for (const s of subs) {
        clientMap.set(s.topic, s.qos);
      }
      this.emit('subscribed', {
        clientId: client.id,
        subscriptions: subs.map((s) => ({ topic: s.topic, qos: s.qos })),
      });
    });

    broker.on('unsubscribe', (unsubs, client) => {
      const clientMap = this.subscriptions.get(client.id);
      if (clientMap) {
        for (const topic of unsubs) {
          clientMap.delete(topic);
        }
      }
    });

    broker.on('publish', (packet, client) => {
      if (packet.topic.startsWith('$SYS/')) return;
      const clientId = client ? client.id : 'broker-internal';
      if (client) {
        this.publisherIds.add(client.id);
      }
      const payloadBuf = Buffer.isBuffer(packet.payload)
        ? packet.payload
        : Buffer.from(packet.payload ?? '');
      const info: BrokerPublishInfo = {
        clientId,
        topic: packet.topic,
        qos: (packet.qos ?? 0) as MqttQoS,
        retain: Boolean(packet.retain),
        payloadSize: payloadBuf.byteLength,
        payloadText: payloadBuf.toString('utf8'),
      };
      this.emit('published', info);
    });

    broker.on('ack', (packet, client) => {
      if (!packet || !client) return;
      this.emit('acknowledged', {
        clientId: client.id,
        cmd: packet.cmd,
        messageId: 'messageId' in packet ? packet.messageId : undefined,
      });
    });

    broker.on('clientError', (client, err) => {
      this.emit('clientError', { clientId: client.id, message: err.message });
    });

    this.aedes = broker;
  }

  private async bindTcpServerWithFallback(): Promise<void> {
    const candidatePorts = [this.port, 1884, 1885, 0];
    let lastErr: Error | null = null;

    for (const candidate of candidatePorts) {
      try {
        await this.startTcpListener(candidate);
        return;
      } catch (err) {
        lastErr = err as Error;
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' && (err as NodeJS.ErrnoException).code !== 'EACCES') {
          throw err;
        }
      }
    }
    throw lastErr ?? new Error('Unable to bind MQTT TCP port');
  }

  private startTcpListener(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.aedes) {
        reject(new Error('Broker not initialized'));
        return;
      }
      const aedesRef = this.aedes;
      const server = net.createServer((socket) => {
        this.activeSockets.add(socket);
        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });
        aedesRef.handle(socket);
      });

      const onError = (err: Error) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          this.port = addr.port;
        }
        this.tcpServer = server;
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, this.host);
    });
  }

  /**
   * Simulates a real MQTT broker outage by closing the TCP listener and terminating active sockets.
   */
  public async interrupt(durationMs?: number): Promise<{ interruptedAt: string }> {
    if (this.mode === 'external') {
      throw new Error('Broker interruption can only be injected in embedded broker mode');
    }
    if (this.status === 'INTERRUPTED') {
      return { interruptedAt: new Date(this.interruptedAtMs ?? Date.now()).toISOString() };
    }

    if (this.autoRestoreTimer) {
      clearTimeout(this.autoRestoreTimer);
      this.autoRestoreTimer = null;
    }

    this.status = 'INTERRUPTED';
    this.interruptedAtMs = Date.now();
    const interruptedAt = new Date(this.interruptedAtMs).toISOString();

    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    this.connectedClients.clear();
    this.subscriptions.clear();

    if (this.tcpServer) {
      await new Promise<void>((resolve) => this.tcpServer?.close(() => resolve()));
      this.tcpServer = null;
    }
    if (this.aedes && !this.aedes.closed) {
      await new Promise<void>((resolve) => this.aedes?.close(() => resolve()));
      this.aedes = null;
    }

    this.emit('brokerInterrupted', { interruptedAt, durationMs });

    if (durationMs && durationMs > 0) {
      this.autoRestoreTimer = setTimeout(() => {
        this.restore().catch(() => {});
      }, durationMs);
    }

    return { interruptedAt };
  }

  public async restore(): Promise<{ restoredAt: string; downtimeMs: number }> {
    if (this.autoRestoreTimer) {
      clearTimeout(this.autoRestoreTimer);
      this.autoRestoreTimer = null;
    }

    if (this.mode === 'external' || this.status === 'ONLINE') {
      return { restoredAt: new Date().toISOString(), downtimeMs: 0 };
    }

    this.status = 'RECOVERING';
    await this.createAedesInstance();
    await this.startTcpListener(this.port);

    const now = Date.now();
    const downtimeMs = this.interruptedAtMs ? Math.max(0, now - this.interruptedAtMs) : 0;
    this.totalDowntimeMs += downtimeMs;
    this.interruptedAtMs = null;
    this.status = 'ONLINE';

    const restoredAt = new Date(now).toISOString();
    this.emit('brokerRestored', { restoredAt, downtimeMs });
    return { restoredAt, downtimeMs };
  }

  public getStatus(): BrokerStatus {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - this.startedAtMs);
    const currentOutageMs = this.interruptedAtMs ? Math.max(0, now - this.interruptedAtMs) : 0;
    const totalDown = this.totalDowntimeMs + currentOutageMs;
    const availabilityPct = Math.max(
      0,
      Math.min(100, Number((((elapsedMs - totalDown) / elapsedMs) * 100).toFixed(2)))
    );

    const activeSubscriptions: Array<{ clientId: string; topic: string; qos: number }> = [];
    const subscribers: string[] = [];
    for (const [clientId, topics] of this.subscriptions.entries()) {
      if (topics.size > 0) subscribers.push(clientId);
      for (const [topic, qos] of topics.entries()) {
        activeSubscriptions.push({ clientId, topic, qos });
      }
    }

    const connectedList = Array.from(this.connectedClients);
    const publishers = connectedList.filter((id) => this.publisherIds.has(id));

    return {
      mode: this.mode,
      status: this.status,
      host: this.host,
      port: this.port,
      protocol: 'MQTT 3.1.1 over TCP',
      startedAt: this.startedAtIso,
      uptimeSeconds: Math.floor(elapsedMs / 1000),
      interruptedAt: this.interruptedAtMs ? new Date(this.interruptedAtMs).toISOString() : null,
      totalDowntimeMs: totalDown,
      availabilityPct,
      connectedClients: connectedList,
      publishers,
      subscribers,
      activeSubscriptions,
      authEnabled: this.authEnabled,
    };
  }

  public async shutdown(): Promise<void> {
    if (this.autoRestoreTimer) {
      clearTimeout(this.autoRestoreTimer);
      this.autoRestoreTimer = null;
    }
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    if (this.tcpServer) {
      await new Promise<void>((resolve) => this.tcpServer?.close(() => resolve()));
      this.tcpServer = null;
    }
    if (this.aedes && !this.aedes.closed) {
      await new Promise<void>((resolve) => this.aedes?.close(() => resolve()));
      this.aedes = null;
    }
  }
}
