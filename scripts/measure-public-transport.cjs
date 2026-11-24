// Public GETs only. Fresh TLS connections; certificates are always validated.
const fs = require('node:fs');
const http2 = require('node:http2');
const dns = require('node:dns/promises');
const tls = require('node:tls');
const hosts = ['pediturno.com', 'canchas.pediturno.com', 'espacios.pediturno.com'];
function sample(host) {
  return new Promise(resolve => {
    const start = performance.now();
    const client = http2.connect(`https://${host}`);
    let settled = false;
    const done = result => { if (!settled) { settled = true; clearTimeout(timer); client.close(); resolve(result); } };
    const timer = setTimeout(() => { client.destroy(); done({ error: 'TIMEOUT' }); }, 20000);
    client.on('error', e => done({ error: e.code || 'HTTP2_UNAVAILABLE' }));
    client.on('connect', () => {
      const alpn = client.socket.alpnProtocol;
      const req = client.request({ ':path': '/', ':method': 'GET' });
      req.on('response', headers => done({ status: headers[':status'], alpn, ttfbMs: Math.round(performance.now() - start), altSvc: headers['alt-svc'] || null }));
      req.on('error', e => done({ error: e.code || 'REQUEST_UNAVAILABLE' }));
      req.resume(); req.end();
    });
  });
}
async function aliasTls() {
  const host = 'www.canchas.pediturno.com';
  let cname, dnsError;
  try { cname = await dns.resolveCname(host); } catch (e) { dnsError = e.code; }
  return new Promise(resolve => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true });
    socket.setTimeout(15000, () => { socket.destroy(); resolve({ host, cname, dnsError, tlsError: 'TIMEOUT' }); });
    socket.once('secureConnect', () => { resolve({ host, cname, dnsError, tlsAuthorized: socket.authorized }); socket.end(); });
    socket.once('error', e => resolve({ host, cname, dnsError, tlsError: e.code || 'TLS_UNAVAILABLE' }));
  });
}
(async () => {
  const results = [];
  for (const host of hosts) {
    const samples = [];
    for (let i = 0; i < 3; i++) samples.push(await sample(host));
    results.push({ host, samples });
  }
  const result = { checkedAt: new Date().toISOString(), method: '3 sequential GETs per host, fresh connection, TTFB includes DNS/TLS; HTTP/3 is not tested', results, alias: await aliasTls() };
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync('output/qa-public-transport.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(() => { console.error('Public transport check incomplete'); process.exitCode = 1; });
