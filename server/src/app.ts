import { createServer } from "node:http";
import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import { Server, type Socket } from "socket.io";
import { env } from "./env.js";
import { LocalWorkspaceStore } from "./storage.js";

const ROOM_CODE = /^[a-zA-Z0-9_-]{3,48}$/;
const USERNAME = /^[^\s].{1,30}$/;
const LANGUAGES = new Set(["javascript", "python", "cpp", "java"]);
type ActiveParticipant = { clientId: string; username: string; socketId: string; joinedAt: number };
type Change = { rangeOffset: number; rangeLength: number; text: string };

function hashPasscode(passcode: string) { const salt = randomUUID(); return `${salt}:${scryptSync(passcode, salt, 32).toString("hex")}`; }
function isPasscodeValid(passcode: string, stored: string) { const [salt, digest] = stored.split(":"); if (!salt || !digest) return false; const expected = Buffer.from(digest, "hex"); const received = scryptSync(passcode, salt, 32); return expected.length === received.length && timingSafeEqual(expected, received); }
function validChanges(value: unknown): value is Change[] { return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every((item) => { const change = item as Partial<Change>; return Number.isInteger(change.rangeOffset) && (change.rangeOffset ?? -1) >= 0 && Number.isInteger(change.rangeLength) && (change.rangeLength ?? -1) >= 0 && typeof change.text === "string" && change.text.length <= 20_000; }); }
function applyChanges(content: string, changes: Change[]) { let next = content; for (const change of changes) { if (change.rangeOffset + change.rangeLength > next.length) return null; next = next.slice(0, change.rangeOffset) + change.text + next.slice(change.rangeOffset + change.rangeLength); } return next; }
function eventLimiter(limit: number, windowMs: number) { let started = Date.now(); let count = 0; return () => { const now = Date.now(); if (now - started >= windowMs) { started = now; count = 0; } return ++count <= limit; }; }

export function createWorkspaceServer(store = new LocalWorkspaceStore()) {
  const activeRooms = new Map<string, Map<string, ActiveParticipant>>();
  const app = express(); const httpServer = createServer(app);
  app.use(cors({ origin: env.clientUrl })); app.use(express.json({ limit: "100kb" }));
  app.get("/health", async (_request, response) => response.status(200).json({ status: "ok", storage: await store.health() }));
  const io = new Server(httpServer, { cors: { origin: env.clientUrl, methods: ["GET", "POST"] }, maxHttpBufferSize: 100_000 });
  const roomName = (code: string) => `room:${code}`;
  const participants = (code: string) => [...(activeRooms.get(code)?.values() ?? [])];
  const publicParticipants = (code: string, hostClientId: string) => participants(code).map(({ clientId, username }) => ({ clientId, username, online: true, isHost: clientId === hostClientId }));
  const activity = async (roomCode: string, type: string, message: string, excludedSocketId?: string) => { const item = await store.addActivity(roomCode, type, message); if (item) io.to(roomName(roomCode)).except(excludedSocketId ?? "").emit("activity", { type, message, createdAt: item.createdAt }); };
  const leaveRoom = async (socket: Socket, roomCode: string, clientId: string) => {
    const active = activeRooms.get(roomCode);
    if (!active || active.get(clientId)?.socketId !== socket.id) return;
    active.delete(clientId); if (active.size === 0) activeRooms.delete(roomCode);
    const room = store.findRoom(roomCode); if (!room) return;
    let hostClientId = room.hostClientId;
    if (hostClientId === clientId && active.size) { const replacement = [...active.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]; hostClientId = replacement.clientId; await store.updateHost(room.code, hostClientId); await activity(roomCode, "host_changed", `${replacement.username} is now the host.`, socket.id); }
    await activity(roomCode, "user_left", `${socket.data.username} left the room.`, socket.id);
    io.to(roomName(roomCode)).emit("participants:update", publicParticipants(roomCode, hostClientId));
  };
  const enterRoom = async (socket: Socket, roomCode: string, clientId: string, username: string, hostClientId: string, document: { content: string; language: string; version: number }, reply?: (value: unknown) => void) => {
    socket.data.roomCode = roomCode; socket.data.clientId = clientId; socket.data.username = username; socket.join(roomName(roomCode));
    const active = activeRooms.get(roomCode) ?? new Map<string, ActiveParticipant>(); const previous = active.get(clientId);
    active.set(clientId, { clientId, username, socketId: socket.id, joinedAt: previous?.joinedAt ?? Date.now() }); activeRooms.set(roomCode, active);
    io.to(roomName(roomCode)).emit("participants:update", publicParticipants(roomCode, hostClientId)); reply?.({ ok: true, clientId, room: { code: roomCode, document, participants: publicParticipants(roomCode, hostClientId) } });
  };
  io.on("connection", (socket) => {
    const documentLimit = eventLimiter(5, 1000); const cursorLimit = eventLimiter(20, 1000); const typingLimit = eventLimiter(10, 1000); let editingAnnounced = false;
    const fail = (event: string, message: string) => socket.emit("room:error", { event, message });
    const membership = () => { const roomCode = socket.data.roomCode as string | undefined; const clientId = socket.data.clientId as string | undefined; return roomCode && clientId ? { roomCode, clientId } : null; };
    socket.on("room:create", async (payload, reply) => { try { const roomCode = String(payload?.roomCode ?? "").trim(); const username = String(payload?.username ?? "").trim(); const clientId = String(payload?.clientId ?? "").trim() || randomUUID(); const passcode = String(payload?.passcode ?? ""); if (!ROOM_CODE.test(roomCode) || !USERNAME.test(username) || clientId.length > 128 || passcode.length > 128) return reply?.({ ok: false, message: "Enter a valid room ID and username." }); if (store.findRoom(roomCode)) return reply?.({ ok: false, message: "That room ID is already in use." }); const room = await store.createRoom(roomCode, clientId, username, passcode ? hashPasscode(passcode) : null); if (!room) return reply?.({ ok: false, message: "That room ID is already in use." }); await enterRoom(socket, room.code, clientId, username, room.hostClientId, room.document, reply); } catch { reply?.({ ok: false, message: "Unable to create the room." }); } });
    socket.on("room:join", async (payload, reply) => { try { const roomCode = String(payload?.roomCode ?? "").trim(); const username = String(payload?.username ?? "").trim(); const clientId = String(payload?.clientId ?? "").trim() || randomUUID(); const passcode = String(payload?.passcode ?? ""); if (!ROOM_CODE.test(roomCode) || !USERNAME.test(username) || clientId.length > 128 || passcode.length > 128) return reply?.({ ok: false, message: "Enter a valid room ID and username." }); const room = store.findRoom(roomCode); if (!room) return reply?.({ ok: false, message: "Room not found." }); if (room.passcodeHash && !isPasscodeValid(passcode, room.passcodeHash)) return reply?.({ ok: false, message: "Incorrect room passcode." }); await store.upsertMember(room.code, clientId, username); await enterRoom(socket, room.code, clientId, username, room.hostClientId, room.document, reply); await activity(room.code, "user_joined", `${username} joined the room.`, socket.id); } catch { reply?.({ ok: false, message: "Unable to join the room." }); } });
    socket.on("document:change", async (payload) => { const member = membership(); if (!member) return fail("document:change", "Join a room first."); if (!documentLimit()) return fail("document:change", "Updates are limited to five per second. Please slow down."); if (!validChanges(payload?.changes) || !Number.isInteger(payload?.version)) return fail("document:change", "Invalid document update."); const room = store.findRoom(member.roomCode); if (!room) return fail("document:change", "Room is unavailable."); if (payload.version !== room.document.version) return socket.emit("document:resync", room.document); const content = applyChanges(room.document.content, payload.changes); if (content === null || content.length > 500_000) return fail("document:change", "Invalid document size."); const document = await store.updateDocument(room.code, content, room.document.version + 1); if (document) socket.to(roomName(room.code)).emit("document:change", { changes: payload.changes, version: document.version, senderId: member.clientId }); });
    socket.on("document:language", async (language) => { const member = membership(); if (!member || typeof language !== "string" || !LANGUAGES.has(language)) return; const room = store.findRoom(member.roomCode); if (room && await store.updateLanguage(room.code, language)) io.to(roomName(room.code)).emit("document:language", language); });
    socket.on("editing:start", async () => { const member = membership(); if (!member || editingAnnounced) return; editingAnnounced = true; if (store.findRoom(member.roomCode)) await activity(member.roomCode, "editing_started", `${socket.data.username} started editing.`, socket.id); });
    socket.on("cursor:update", (cursor) => { const member = membership(); if (!member || !cursorLimit() || !Number.isInteger(cursor?.lineNumber) || !Number.isInteger(cursor?.column) || cursor.lineNumber < 1 || cursor.column < 1) return; socket.to(roomName(member.roomCode)).emit("cursor:update", { lineNumber: cursor.lineNumber, column: cursor.column, clientId: member.clientId, username: socket.data.username }); });
    socket.on("typing", (typing) => { const member = membership(); if (member && typingLimit()) socket.to(roomName(member.roomCode)).emit("typing", { clientId: member.clientId, username: socket.data.username, typing: Boolean(typing) }); });
    socket.on("disconnect", () => { const member = membership(); if (member) void leaveRoom(socket, member.roomCode, member.clientId); });
  });
  return { app, httpServer, io, store, initialize: () => store.initialize() };
}
