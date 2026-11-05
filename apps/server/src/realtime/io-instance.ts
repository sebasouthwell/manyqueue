import type { Server } from "socket.io";

let io: Server | null = null;

export function setIO(instance: Server): void {
  io = instance;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.IO server not initialized yet");
  return io;
}
