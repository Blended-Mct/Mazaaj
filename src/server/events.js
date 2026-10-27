// Server-Sent Events hub: pushes incoming-call screen-pops to open agent screens.

export class EventHub {
  constructor({ heartbeatMs = 25000 } = {}) {
    this.clients = new Set();
    this.timer = setInterval(() => {
      for (const c of this.clients) c.res.write(': keep-alive\n\n');
    }, heartbeatMs);
    this.timer.unref?.();
  }

  add(req, res, { agentId = null } = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client = { res, agentId };
    this.clients.add(client);
    req.on('close', () => this.clients.delete(client));
    this.send(client, 'hello', { connectedAt: new Date().toISOString(), listeners: this.clients.size });
  }

  send(client, type, data) {
    client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Sends to every listener, or only to listeners registered for `agentId` (plus those listening to all). */
  broadcast(type, data, agentId = null) {
    let delivered = 0;
    for (const c of this.clients) {
      if (agentId && c.agentId && c.agentId !== agentId) continue;
      this.send(c, type, data);
      delivered += 1;
    }
    return delivered;
  }

  close() {
    clearInterval(this.timer);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }
}
