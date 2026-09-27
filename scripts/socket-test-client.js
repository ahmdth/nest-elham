import { io } from 'socket.io-client';

const url = process.env.SOCKET_URL || 'http://localhost:3000';

console.log(`Connecting to ${url} (namespace "/", path "/socket.io") ...`);

const socket = io(url, {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
  console.log(`[connected] socket id = ${socket.id}`);
});

socket.on('slot.booked', (payload) => {
  console.log('[slot.booked]', JSON.stringify(payload));
});

socket.on('slot.released', (payload) => {
  console.log('[slot.released]', JSON.stringify(payload));
});

socket.on('disconnect', (reason) => {
  console.log(`[disconnected] ${reason}`);
});

socket.on('connect_error', (err) => {
  console.error('[connect_error]', err.message);
});

process.on('SIGINT', () => {
  socket.close();
  process.exit(0);
});
