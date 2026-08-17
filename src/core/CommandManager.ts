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

// Helper function to safely extract (x, y) coordinates from any entity, player, object, or trap
function getPos(entity: any): { x: number; y: number } | null {
    if (!entity) return null;
    if (entity.position && typeof entity.position.x === "number" && typeof entity.position.y === "number") {
        return entity.position;
    }
    if (entity.pos && typeof entity.pos.x === "number" && typeof entity.pos.y === "number") {
        return entity.pos;
    }
    if (typeof entity.x === "number" && typeof entity.y === "number") {
        return { x: entity.x, y: entity.y };
    }
    return null;
}

// Tier mapping: r = Ruby (3), d = Diamond (2), g = Gold (1), s = Stone (0)
const TIER_MAP: Record<string, number> = {
    r: 3, ruby: 3,
    d: 2, dia: 2, diamond: 2,
    g: 1, gold: 1,
    s: 0, stone: 0
};

// Helper function to apply upgrade tiers to primary and secondary weapon IDs
function applyWeaponTiers(player: Player, primaryTier: number, secondaryTier: number) {
    const primaryId = player.weapons[0] !== undefined ? player.weapons[0] : player.weaponIndex;
    const secondaryId = player.weapons[1];

    if (primaryId !== undefined) {
        player.weaponXP[primaryId] = weaponVariants[primaryTier]?.xp ?? 0;
    }

    if (secondaryId !== undefined) {
        player.weaponXP[secondaryId] = weaponVariants[secondaryTier]?.xp ?? 0;
    }

    // Ensure the currently held weapon reflects the upgrade immediately
    if (secondaryId !== undefined && player.weaponIndex === secondaryId) {
        player.weaponXP[player.weaponIndex] = weaponVariants[secondaryTier]?.xp ?? 0;
    } else {
        player.weaponXP[player.weaponIndex] = weaponVariants[primaryTier]?.xp ?? 0;
    }
}

export default class CommandManager {
    static process(player: Player, msg: string) {
        const parsed = msg.slice(1).split(" ");
        const cmdId = parsed[0].toLowerCase();
        const arg1 = parsed[1] ? parsed[1].toLowerCase() : "";

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
        // 1. Dual weapon upgrade combos (e.g. !rd, !dr, !rg, !gr, !dg, !gd, !rr, !dd, !gg, !rs, etc.)
        } else if (cmdId.length === 2 && cmdId !== "ss" && cmdId[0] in TIER_MAP && cmdId[1] in TIER_MAP) {
            const primaryTier = TIER_MAP[cmdId[0]];
            const secondaryTier = TIER_MAP[cmdId[1]];
            applyWeaponTiers(player, primaryTier, secondaryTier);

        // 2. Dual weapon upgrades with arguments (e.g. !r d, !ruby diamond, !gold ruby)
        } else if (cmdId in TIER_MAP && arg1 in TIER_MAP) {
            const primaryTier = TIER_MAP[cmdId];
            const secondaryTier = TIER_MAP[arg1];
            applyWeaponTiers(player, primaryTier, secondaryTier);

        // 3. Single weapon upgrade for currently held weapon (e.g. !r, !d, !g, !stone)
        } else if (cmdId in TIER_MAP && cmdId !== "s") {
            const tier = TIER_MAP[cmdId];
            player.weaponXP[player.weaponIndex] = weaponVariants[tier]?.xp ?? 0;

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
                // Kill specific bot by ID
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

            // Dummy session to prevent packet send crashes
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

            // Hat handling (t = Tank Gear, ss = Soldier Helmet)
            if (cmdParts.includes("t")) {
                bot.skinIndex = (STORE_HAT_MAP as any).TANK_GEAR ?? (STORE_HAT_MAP as any).TANK_HELMET ?? (STORE_HAT_MAP as any).TANK ?? 40;
            } else if (cmdParts.filter(e => e === "s").length >= 2) {
                bot.skinIndex = STORE_HAT_MAP.SOLDIER_HELMET;
            }

            // Heal handling (h = Heal)
            if (cmdParts.includes("h")) {
                bot.aiSettings.heal = true;
            }

            // Hammer & Auto-Aim Breaker (b = Breaker)
            if (cmdParts.includes("b")) {
                const hammerId = (WEAPON_ID_MAP as any).GREAT_HAMMER ?? (WEAPON_ID_MAP as any).TOOL_HAMMER ?? (WEAPON_ID_MAP as any).HAMMER ?? 0;
                bot.weapons[0] = bot.weaponIndex = hammerId;

                (bot.aiSettings as any).hit = true;
                (bot as any).isAttacking = true;
                (bot as any).isHitting = true;
                (bot as any).gathering = true;

                // 400ms normal hammer attack cooldown
                const hammerCooldown = hammerId === (WEAPON_ID_MAP as any).TOOL_HAMMER ? 300 : 400;

                const attackInterval = setInterval(() => {
                    try {
                        if (!bot || !bot.isAlive || !PlayerManager.players.some(p => p.sid === bot.sid)) {
                            clearInterval(attackInterval);
                            if ((SessionManager as any).sessions instanceof Map) {
                                (SessionManager as any).sessions.delete(bot.socketId);
                            } else if ((SessionManager as any).sessions) {
                                delete (SessionManager as any).sessions[bot.socketId];
                            }
                            return;
                        }

                        const botPos = getPos(bot);
                        if (!botPos) return;

                        let targetPos: { x: number; y: number } | null = null;

                        // Check if bot is trapped in a trap (prioritize trap center)
                        const trap = (bot as any).trap ?? (bot as any).trapObject ?? (bot as any).trapped;
                        if (trap && (trap.health === undefined || trap.health > 0) && trap.isAlive !== false) {
                            targetPos = getPos(trap);
                        }

                        // If not trapped, find the nearest living object / structure
                        if (!targetPos) {
                            let minDistanceSq = Infinity;

                            for (const obj of ObjectManager.gameObjects) {
                                if (!obj || (typeof obj.health === "number" && obj.health <= 0) || (obj as any).isAlive === false) {
                                    continue;
                                }

                                const objPos = getPos(obj);
                                if (!objPos) continue;

                                const dSq = getDistSq(objPos, botPos);
                                if (dSq < minDistanceSq) {
                                    minDistanceSq = dSq;
                                    targetPos = objPos;
                                }
                            }
                        }

                        // Auto-aim towards the center of the target object / trap
                        if (targetPos) {
                            const dx = targetPos.x - botPos.x;
                            const dy = targetPos.y - botPos.y;

                            if (dx !== 0 || dy !== 0) {
                                const targetAngle = Math.atan2(dy, dx);
                                bot.angle = targetAngle;
                                (bot as any).targetAngle = targetAngle;
                                (bot as any).dir = targetAngle;
                                (bot as any).rotation = targetAngle;
                                (bot as any).viewAngle = targetAngle;
                            }
                        }

                        // Trigger weapon hit
                        if (typeof (bot as any).hit === "function") {
                            (bot as any).hit(bot.angle ?? 0);
                        } else if (typeof (bot as any).attack === "function") {
                            (bot as any).attack(bot.angle ?? 0);
                        } else if (typeof (bot as any).gather === "function") {
                            (bot as any).gather();
                        }
                    } catch (err) {
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
