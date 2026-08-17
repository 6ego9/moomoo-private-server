import ArenaManager from "@core/ArenaManager";
import PlayerManager from "@core/PlayerManager";
import SessionManager from "@network/SessionManager";
import getDistSq from "@utils/getDistSq";
import { WEAPON_ID_MAP } from "@utils/items";
import PacketMap from "@utils/PacketMap";
import Player, { weaponVariants } from "@utils/Player";
import randInt from "@utils/randInt";
import randString from "@utils/randString";
import { STORE_HAT_MAP } from "@utils/store";
import ObjectManager from "@core/ObjectManager";

export default class CommandManager {
    static process(player: Player, msg: string) {
        const parsed = msg.slice(1).split(" ");
        const cmdId = parsed[0];

        if (cmdId === "n" || cmdId === "nearest") {
            const nearest = PlayerManager.players
                .filter(other => other && other.isAlive && other.sid !== player.sid && other.position)
                .sort((a, b) => getDistSq(a.position, player.position) - getDistSq(b.position, player.position))[0];

            if (nearest && nearest.position) {
                player.position.x = nearest.position.x;
                player.position.y = nearest.position.y;
            }
        } else if (cmdId === "clear") {
            const sids = ObjectManager.gameObjects.map(obj => obj.sid);
            for (const sid of sids) {
                ObjectManager.remove(sid);
            }
        } else if (cmdId === "r" || cmdId === "ruby") {
            player.weaponXP[player.weaponIndex] = weaponVariants[3].xp;
        } else if (cmdId === "d" || cmdId === "dia") {
            player.weaponXP[player.weaponIndex] = weaponVariants[2].xp;
        } else if (cmdId === "g" || cmdId === "gold") {
            player.weaponXP[player.weaponIndex] = weaponVariants[1].xp;
        } else if (cmdId === "stone") {
            player.weaponXP[player.weaponIndex] = 0;
        } else if (cmdId === "k" || cmdId === "kill") {
            player.kill(player);
        } else if (cmdId === "kb" || cmdId === "killbot" || cmdId === "killbots") {
            const targetArg = parsed[1];

            if (!targetArg || targetArg.toLowerCase() === "all") {
                // Kill all active bots
                const bots = PlayerManager.players.filter(p => p && p.isAI && p.isAlive);
                for (const bot of bots) {
                    try {
                        bot.kill(player);
                    } catch (e) {
                        bot.isAlive = false;
                    }
                }
            } else {
                // Kill specific bot by SID / ID
                const targetSid = parseInt(targetArg);
                const targetBot = PlayerManager.players.find(p => p && p.sid === targetSid && p.isAI && p.isAlive);

                if (targetBot) {
                    try {
                        targetBot.kill(player);
                    } catch (e) {
                        targetBot.isAlive = false;
                    }
                }
            }
        } else if (cmdId === "spawn" || cmdId.startsWith("s")) {
            const bot = PlayerManager.create(randString(), "Bot");
            bot.position.x = player.position.x + randInt(-500, 500);
            bot.position.y = player.position.y + randInt(-500, 500);
            bot.isAI = true;

            // 1. Prevent packet crashes: Register dummy session for the bot
            const dummySession = {
                socketId: bot.socketId,
                send: () => {},
                close: () => {},
                player: bot,
                socket: { readyState: 1, send: () => {} }
            };

            if ((SessionManager as any).sessions instanceof Map) {
                (SessionManager as any).sessions.set(bot.socketId, dummySession);
            } else if ((SessionManager as any).sessions) {
                (SessionManager as any).sessions[bot.socketId] = dummySession;
            }

            const cmdParts = cmdId.split("");

            // 2. Hat handling (t = Tank Gear, ss = Soldier Helmet)
            if (cmdParts.includes("t")) {
                bot.skinIndex = (STORE_HAT_MAP as any).TANK_GEAR ?? (STORE_HAT_MAP as any).TANK_HELMET ?? (STORE_HAT_MAP as any).TANK ?? 40;
            } else if (cmdParts.filter(e => e === "s").length >= 2) {
                bot.skinIndex = STORE_HAT_MAP.SOLDIER_HELMET;
            }

            // 3. Heal handling (h = Heal)
            if (cmdParts.includes("h")) {
                bot.aiSettings.heal = true;
            }

            // 4. Hammer & Auto-Aim Breaker (b = Breaker)
            if (cmdParts.includes("b")) {
                const hammerId = (WEAPON_ID_MAP as any).GREAT_HAMMER ?? (WEAPON_ID_MAP as any).TOOL_HAMMER ?? (WEAPON_ID_MAP as any).HAMMER ?? 0;
                bot.weapons[0] = bot.weaponIndex = hammerId;

                (bot.aiSettings as any).hit = true;
                (bot as any).isAttacking = true;
                (bot as any).isHitting = true;
                (bot as any).gathering = true;

                // 400ms normal Great Hammer attack cooldown
                const hammerCooldown = hammerId === (WEAPON_ID_MAP as any).TOOL_HAMMER ? 300 : 400;

                const attackInterval = setInterval(() => {
                    try {
                        // Check if bot is dead or removed from the server
                        if (!bot || !bot.isAlive || !PlayerManager.players.some(p => p.sid === bot.sid)) {
                            clearInterval(attackInterval);
                            
                            // Cleanup dummy session
                            if ((SessionManager as any).sessions instanceof Map) {
                                (SessionManager as any).sessions.delete(bot.socketId);
                            } else if ((SessionManager as any).sessions) {
                                delete (SessionManager as any).sessions[bot.socketId];
                            }
                            return;
                        }

                        if (!bot.position) return;

                        // Safely filter living breakable objects
                        const validObjects = ObjectManager.gameObjects.filter(
                            obj => obj && 
                                   obj.position && 
                                   typeof obj.position.x === "number" && 
                                   typeof obj.position.y === "number" && 
                                   (obj.health === undefined || obj.health > 0) && 
                                   (obj as any).isAlive !== false
                        );

                        if (validObjects.length > 0) {
                            const nearestObj = validObjects.sort(
                                (a, b) => getDistSq(a.position, bot.position) - getDistSq(b.position, bot.position)
                            )[0];

                            if (nearestObj && nearestObj.position) {
                                bot.angle = Math.atan2(nearestObj.position.y - bot.position.y, nearestObj.position.x - bot.position.x);
                            }
                        }

                        // Trigger weapon swing
                        if (typeof (bot as any).hit === "function") {
                            (bot as any).hit(bot.angle ?? 0);
                        } else if (typeof (bot as any).attack === "function") {
                            (bot as any).attack(bot.angle ?? 0);
                        } else if (typeof (bot as any).gather === "function") {
                            (bot as any).gather();
                        }
                    } catch (err) {
                        // Prevent unhandled errors from crashing the server
                        console.error("Bot loop error (safely caught):", err);
                    }
                }, hammerCooldown);
            } else {
                bot.weapons[0] = bot.weaponIndex = WEAPON_ID_MAP.POLEARM;
            }
        } else if (cmdId === "reset" || cmdId === "re") {
            const session = SessionManager.get(player.socketId)!;
            const lastX = player.position.x;
            const lastY = player.position.y;

            player.spawn(player.name);
            player.position.x = lastX;
            player.position.y = lastY;

            session.send(PacketMap.SERVER_TO_CLIENT.UPDATE_ITEMS, player.weapons, true);
            session.send(PacketMap.SERVER_TO_CLIENT.UPDATE_UPGRADES, player.upgradePoints, player.upgrAge);
        } else if (cmdId === "tp") {
            const victim = PlayerManager.players.find(e => e.sid === parseInt(parsed[1]));

            if (victim && victim.position) {
                player.position.x = victim.position.x;
                player.position.y = victim.position.y;
            }
        } else if (cmdId === "a") {
            ArenaManager.process(player, parsed);
        }
    }
}
