import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type StoredDocument = { content: string; language: string; version: number };
export type StoredRoom = {
  id: string; code: string; passcodeHash: string | null; hostClientId: string;
  createdAt: string; updatedAt: string; document: StoredDocument;
  members: Record<string, { username: string; joinedAt: string }>;
  activities: StoredActivity[];
};
export type StoredActivity = { id: string; type: string; message: string; createdAt: string };
type StoreFile = { rooms: Record<string, StoredRoom> };

/**
 * Development persistence adapter. Its public methods are deliberately shaped
 * around rooms/documents rather than filesystem operations, so a future Prisma
 * adapter can implement the same boundary without touching Socket.IO handlers.
 */
export class LocalWorkspaceStore {
  private state: StoreFile = { rooms: {} };
  private writes = Promise.resolve();
  private readonly path: string;

  constructor(filePath = process.env.LOCAL_DATA_FILE ?? resolve(process.cwd(), "data", "workspace.json")) {
    this.path = resolve(filePath);
  }

  async initialize() {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<StoreFile>;
      if (!parsed.rooms || typeof parsed.rooms !== "object" || Array.isArray(parsed.rooms)) throw new Error("Invalid local workspace data.");
      this.state = { rooms: parsed.rooms ?? {} };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Preserve the bad file for recovery, then start with a usable empty store.
        try { await rename(this.path, `${this.path}.corrupt-${Date.now()}`); } catch { /* a read-only/corrupt file should not block local development */ }
      }
      this.state = { rooms: {} };
      await this.persist();
    }
  }

  async health() { return { file: this.path, rooms: Object.keys(this.state.rooms).length }; }
  findRoom(code: string) { return this.copy(this.state.rooms[code]); }

  async createRoom(code: string, clientId: string, username: string, passcodeHash: string | null) {
    if (this.state.rooms[code]) return null;
    const now = new Date().toISOString();
    const room: StoredRoom = { id: randomUUID(), code, passcodeHash, hostClientId: clientId, createdAt: now, updatedAt: now, document: { content: "", language: "javascript", version: 0 }, members: { [clientId]: { username, joinedAt: now } }, activities: [] };
    this.state.rooms[code] = room;
    await this.addActivity(code, "room_created", `${username} created the room.`);
    return this.copy(room)!;
  }

  async upsertMember(code: string, clientId: string, username: string) {
    const room = this.state.rooms[code]; if (!room) return null;
    room.members[clientId] = { username, joinedAt: room.members[clientId]?.joinedAt ?? new Date().toISOString() };
    room.updatedAt = new Date().toISOString(); await this.persist(); return this.copy(room)!;
  }
  async updateDocument(code: string, content: string, version: number) {
    const room = this.state.rooms[code]; if (!room) return null;
    room.document = { ...room.document, content, version }; room.updatedAt = new Date().toISOString(); await this.persist(); return this.copy(room.document)!;
  }
  async updateLanguage(code: string, language: string) {
    const room = this.state.rooms[code]; if (!room) return null;
    room.document.language = language; room.updatedAt = new Date().toISOString(); await this.persist(); return this.copy(room)!;
  }
  async updateHost(code: string, hostClientId: string) {
    const room = this.state.rooms[code]; if (!room) return null;
    room.hostClientId = hostClientId; room.updatedAt = new Date().toISOString(); await this.persist(); return this.copy(room)!;
  }
  async addActivity(code: string, type: string, message: string) {
    const room = this.state.rooms[code]; if (!room) return null;
    const activity: StoredActivity = { id: randomUUID(), type, message, createdAt: new Date().toISOString() };
    room.activities.push(activity); room.activities = room.activities.slice(-100); room.updatedAt = activity.createdAt;
    await this.persist(); return { ...activity };
  }
  private copy<T>(value: T): T | undefined { return value === undefined ? undefined : structuredClone(value); }
  private async persist() {
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.tmp`;
      await writeFile(temp, JSON.stringify(this.state, null, 2), "utf8");
      await rename(temp, this.path);
    });
    return this.writes;
  }
}
