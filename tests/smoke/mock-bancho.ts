import { createServer } from 'node:http';
import { mockBancho } from '../helpers/mock-bancho';
if (process.env.ALLOW_MOCK_BANCHO !== 'yes')
  throw new Error('Mock Bancho requires the explicit QA configuration.');
const mock = mockBancho();
mock.server.listen(6667, '0.0.0.0');
createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(request.url === '/transcript' ? JSON.stringify(mock.lines) : '{"mock":true}');
}).listen(8081, '0.0.0.0');
console.log('Test-only mock Bancho ready; PASS lines are excluded from transcript.');
