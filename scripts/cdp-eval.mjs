// Minimal Metro CDP evaluator (node + ws): node scripts/cdp-eval.mjs <port> <expression>
// Prints the JSON-serialized result of Runtime.evaluate on the first device
// target listed by the Metro inspector on that port.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const WebSocketModule = require('../node_modules/.bun/ws@8.21.1/node_modules/ws');
const WebSocket = WebSocketModule.default ?? WebSocketModule.WebSocket ?? WebSocketModule;

const [port, expression, index] = process.argv.slice(2);
if (!port || !expression) {
  console.error('usage: node scripts/cdp-eval.mjs <port> <expression> [targetIndex]');
  process.exit(1);
}

const list = await (await fetch(`http://localhost:${port}/json/list`)).json();
const target = list[Number(index ?? 0)];
if (!target) {
  console.error('no device target on port', port);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, {
  perMessageDeflate: false,
  headers: {
    Origin: `http://localhost:${port}`,
    'User-Agent': 'react-native-debugger',
  },
});
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('evaluate timeout (30s)')), 30_000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 0, method: 'Runtime.enable' }));
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.id !== 1) {
      if (msg.id === 0 && msg.error) console.error('Runtime.enable error:', msg.error);
      return;
    }
    clearTimeout(timer);
    if (msg.error || msg.result?.exceptionDetails) {
      reject(new Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails)));
    } else {
      resolve(msg.result?.result?.value);
    }
  });
  ws.on('error', (e) => reject(e));
});
ws.close();
console.log(JSON.stringify(result));
