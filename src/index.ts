import ArenaManager from "@core/ArenaManager";
import ObjectManager from "@core/ObjectManager";
import PlayerManager from "@core/PlayerManager";
import ProjectileManager from "@core/ProjectileManager";
import SessionManager from "@network/SessionManager";
import Configuration from "@utils/Configuration";
import getLeaderboardData from "@utils/getLeaderboardData";
import PacketMap from "@utils/PacketMap";
import axios from "axios";
import { config } from "dotenv";
import express from "express";
import { WebSocketServer } from "ws";

config({ quiet: true });
const PORT = process.env.PORT || 1234;

const app = express();
const server = app.listen(PORT, () => console.log(`Server listening to port ${PORT}`));
const wss = new WebSocketServer({ noServer: true });

app.use(express.static("public"));

app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.get("/ping", (_, res) => res.send("Success"));

app.get("/img/:type/:filename", async (req, res) => {
    try {
        const { type, filename } = req.params;

        if (!filename || !type) {
            return res.status(400).send("Missing file path");
        }

        const remoteUrl = `https://moomoo.io/img/${type}/${filename}`;

        const response = await axios.get(remoteUrl, {
            responseType: "arraybuffer",
            validateStatus: () => true,
        });

        if (response.status !== 200) {
            return res.status(response.status).send("Upstream error");
        }

        const contentType = response.headers["content-type"] || "application/octet-stream";

        res.setHeader("Content-Type", contentType as any);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(response.data);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch image");
    }
});

setInterval(() => {
    ArenaManager.update();

    PlayerManager.update();
    ObjectManager.update();
    ProjectileManager.update();

    PlayerManager.postTick();
}, Configuration.SERVER_UPDATE_SPEED);

function updateLeaderboards() {
    const players = PlayerManager.players;
    const data = getLeaderboardData();

    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        if (!player) continue;
        const playerSession = SessionManager.get(player.socketId);
        if (playerSession) playerSession.send(PacketMap.SERVER_TO_CLIENT.UPDATE_LEADERBOARD, data);
    }
}

setInterval(() => {
    const players = PlayerManager.players;
    updateLeaderboards();

    for (let i = players.length - 1; i >= 0; i--) {
        const player = players[i];

        if (player && !player.isAlive && player.isAI) {
            PlayerManager.remove(player.sid);
        }
    }
}, 3e3);

wss.on("connection", (ws) => {
    if (ArenaManager.status) return ws.terminate();
    ws.binaryType = "arraybuffer";
    SessionManager.create(ws);
});

server.on("upgrade", (req, stream, head) => {
    wss.handleUpgrade(req, stream, head, (ws) => {
        wss.emit("connection", ws, req);
    });
});