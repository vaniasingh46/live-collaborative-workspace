import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { createWorkspaceServer } from "../src/app.js";
import { LocalWorkspaceStore } from "../src/storage.js";

let url = "";
let workspace: ReturnType<typeof createWorkspaceServer>;
const sockets: Socket[] = [];
const connect = async () => {
  const socket = io(url, { transports: ["websocket"] }); sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", resolve)); return socket;
};
const emit = <T>(socket: Socket, event: string, payload: unknown) => new Promise<T>((resolve) => socket.emit(event, payload, resolve));
const next = <T>(socket: Socket, event: string) => new Promise<T>((resolve) => socket.once(event, resolve));

before(async () => {
  const directory = await mkdtemp(join(tmpdir(), "collab-test-"));
  workspace = createWorkspaceServer(new LocalWorkspaceStore(join(directory, "workspace.json")));
  await workspace.initialize(); await new Promise<void>((resolve) => workspace.httpServer.listen(0, resolve));
  const address = workspace.httpServer.address(); if (!address || typeof address === "string") throw new Error("No test server address"); url = `http://127.0.0.1:${address.port}`;
});
after(async () => { sockets.forEach((socket) => socket.disconnect()); await new Promise<void>((resolve) => workspace.io.close(() => workspace.httpServer.close(() => resolve()))); });

test("creates, joins, syncs, reassigns host, and reconnects without duplicate presence", async () => {
  const ayush = await connect(); const rahul = await connect(); const priya = await connect();
  const created = await emit<{ ok: boolean }>(ayush, "room:create", { roomCode: "demo-room", username: "Ayush", clientId: "ayush" }); assert.equal(created.ok, true);
  const joinedRahul = await emit<{ ok: boolean }>(rahul, "room:join", { roomCode: "demo-room", username: "Rahul", clientId: "rahul" }); assert.equal(joinedRahul.ok, true);
  const joinedPriya = await emit<{ ok: boolean }>(priya, "room:join", { roomCode: "demo-room", username: "Priya", clientId: "priya" }); assert.equal(joinedPriya.ok, true);
  const changed = next<{ version: number }>(rahul, "document:change"); ayush.emit("document:change", { version: 0, changes: [{ rangeOffset: 0, rangeLength: 0, text: "hello" }] }); assert.equal((await changed).version, 1);
  const reassigned = next<Array<{ clientId: string; isHost: boolean }>>(priya, "participants:update"); ayush.disconnect(); const presence = await reassigned; assert.equal(presence.find((person) => person.clientId === "rahul")?.isHost, true);
  const reconnected = await connect(); const reply = await emit<{ ok: boolean; room: { participants: Array<{ clientId: string }> } }>(reconnected, "room:join", { roomCode: "demo-room", username: "Ayush", clientId: "ayush" }); assert.equal(reply.ok, true); assert.equal(reply.room.participants.filter((person) => person.clientId === "ayush").length, 1);
});

test("rejects passcode failures, unauthorised edits, malformed events, and update spam", async () => {
  const owner = await connect(); const intruder = await connect();
  await emit(owner, "room:create", { roomCode: "locked-room", username: "Owner", clientId: "owner", passcode: "secret" });
  const rejected = await emit<{ ok: boolean; message: string }>(intruder, "room:join", { roomCode: "locked-room", username: "Intruder", clientId: "intruder", passcode: "wrong" }); assert.equal(rejected.ok, false); assert.match(rejected.message, /passcode/i);
  const unauthorised = next<{ message: string }>(intruder, "room:error"); intruder.emit("document:change", { version: 0, changes: [] }); assert.match((await unauthorised).message, /Join a room/i);
  const error = next<{ message: string }>(owner, "room:error"); for (let index = 0; index < 6; index += 1) owner.emit("document:change", { version: 0, changes: [{ rangeOffset: 0, rangeLength: 0, text: "x" }] }); assert.match((await error).message, /five per second/i);
});
