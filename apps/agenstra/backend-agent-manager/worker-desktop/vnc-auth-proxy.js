#!/usr/bin/env node
'use strict';

/**
 * Authenticated WebSocket front for websockify.
 * Requires HTTP Basic auth matching OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD
 * before proxying to the loopback websockify instance.
 */

const http = require('http');
const net = require('net');

const listenHost = process.env.VNC_AUTH_PROXY_HOST || '0.0.0.0';
const listenPort = parseInt(process.env.VNC_WEBSOCKIFY_PORT || '6080', 10);
const upstreamHost = process.env.VNC_WEBSOCKIFY_UPSTREAM_HOST || '127.0.0.1';
const upstreamPort = parseInt(process.env.VNC_WEBSOCKIFY_UPSTREAM_PORT || '6081', 10);
const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const password = process.env.OPENCODE_SERVER_PASSWORD || '';

if (!password) {
  console.error('OPENCODE_SERVER_PASSWORD is required for the VNC auth proxy');
  process.exit(1);
}

const expected = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

function authorized(req) {
  const header = req.headers.authorization || '';
  const match = /^Basic\s+(.+)$/i.exec(header);

  if (!match) {
    return false;
  }

  return match[1] === expected;
}

const server = http.createServer((_req, res) => {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="agenstra-vnc"' });
  res.end('Unauthorized');
});

server.on('upgrade', (req, socket, head) => {
  if (!authorized(req)) {
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="agenstra-vnc"\r\nConnection: close\r\n\r\n',
    );
    socket.destroy();

    return;
  }

  const upstream = net.connect(upstreamPort, upstreamHost, () => {
    let request = `${req.method} ${req.url || '/'} HTTP/1.1\r\n`;

    for (const [key, value] of Object.entries(req.headers)) {
      if (!value || key.toLowerCase() === 'authorization') {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          request += `${key}: ${item}\r\n`;
        }
      } else {
        request += `${key}: ${value}\r\n`;
      }
    }

    request += '\r\n';
    upstream.write(request);

    if (head && head.length) {
      upstream.write(head);
    }

    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on('error', () => {
    socket.destroy();
  });

  socket.on('error', () => {
    upstream.destroy();
  });
});

server.listen(listenPort, listenHost, () => {
  console.log(`VNC auth proxy listening on ${listenHost}:${listenPort} → ${upstreamHost}:${upstreamPort}`);
});
