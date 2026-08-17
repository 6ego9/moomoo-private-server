import Session from "@network/Session";
import randString from "@utils/randString";
import { WebSocket } from "ws";

export default class SessionManager {
    private static sessionIdMap = new Map<string, Session>();

    // Expose all active sessions
    static get sessions() {
        return this.sessionIdMap;
    }

    static create(ws: WebSocket) {
        let id = randString();

        while (this.sessionIdMap.has(id))
            id = randString();

        const session = new Session(id, ws);
        this.sessionIdMap.set(id, session);
        return session;
    }

    static get(id: string) {
        return this.sessionIdMap.get(id);
    }

    static terminate(id: string) {
        const session = this.sessionIdMap.get(id);
        if (!session) return;

        this.sessionIdMap.delete(id);
        return session.terminate();
    }

    // Broadcast a packet to every active player on the server
    static broadcast(packetType: any, ...args: any[]) {
        for (const session of this.sessionIdMap.values()) {
            if (session && typeof session.send === "function" && session.socket && session.socket.readyState === WebSocket.OPEN) {
                try {
                    session.send(packetType, ...args);
                } catch (e) {}
            }
        }
    }
}
