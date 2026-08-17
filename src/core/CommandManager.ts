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
                const bots = PlayerManager.players.filter(p => p && p.isAI && p.isAlive);
                for (const bot of bots) {
                    try {
                        bot.kill(player);
                    } catch (e) {
                        bot.isAlive = false;
                    }
                }
            } else {
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
        // 4. Bot Spawner (supports !sc, !sthb, !ssh, !s, etc. and spawn count numbers e.g. !sc 2, !sthb 3)
        } else if (cmdId === "spawn" || cmdId.startsWith("s")) {
            let spawnCount = 1;
            if (parsed[1] && !isNaN(parseInt(parsed[1]))) {
                spawnCount = Math.max(1, Math.min(30, parseInt(parsed[1])));
            }

            const cmdParts = cmdId.split("");
            const isCombatBot = cmdParts.includes("c") || cmdId === "sc";

            for (let n = 0; n < spawnCount; n++) {
                const botName = isCombatBot ? ("CombatBot" + (spawnCount > 1 ? `_${n + 1}` : "")) : "Bot";
                const bot = PlayerManager.create(randString(), botName);
                bot.position.x = player.position.x + randInt(-350, 350);
                bot.position.y = player.position.y + randInt(-350, 350);
                bot.isAI = true;

                // Dummy session for packet safety
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

                
                //  COMBAT BOT LOGIC (!sc)
                
                if (isCombatBot) {
                    // Equip Ruby Katana & Great Hammer
                    const katanaId = (WEAPON_ID_MAP as any).KATANA ?? (WEAPON_ID_MAP as any).POLEARM ?? 4;
                    const hammerId = (WEAPON_ID_MAP as any).GREAT_HAMMER ?? 10;
                    bot.weapons[0] = bot.weaponIndex = katanaId;
                    bot.weapons[1] = hammerId;

                    if (bot.weaponXP) {
                        bot.weaponXP[katanaId] = weaponVariants[3]?.xp ?? 0;
                        bot.weaponXP[hammerId] = weaponVariants[3]?.xp ?? 0;
                    }

                    bot.skinIndex = (STORE_HAT_MAP as any).BOOSTER_HAT ?? 12;
                    (bot as any).tailIndex = 11; // Monkey tail for speed

                    let lastAttackTime = 0;
                    let lastPlaceTime = 0;
                    let lastHealTime = 0;
                    let strafeDirection = 1;

                    const combatInterval = setInterval(() => {
                        try {
                            if (!bot || !bot.isAlive || !PlayerManager.players.some(p => p.sid === bot.sid)) {
                                clearInterval(combatInterval);
                                if ((SessionManager as any).sessions instanceof Map) {
                                    (SessionManager as any).sessions.delete(bot.socketId);
                                } else if ((SessionManager as any).sessions) {
                                    delete (SessionManager as any).sessions[bot.socketId];
                                }
                                return;
                            }

                            const botPos = getPos(bot);
                            if (!botPos) return;

                            const now = Date.now();

                            // 1. TRAP ESCAPING (Auto-Break)
                            let targetTrap: any = (bot as any).trap ?? (bot as any).trapObject ?? (bot as any).trapped;
                            if (!targetTrap) {
                                targetTrap = ObjectManager.gameObjects.find(obj => 
                                    obj && obj.id === 15 && getPos(obj) && getDistSq(getPos(obj)!, botPos) <= 60 * 60 && (obj as any).health > 0
                                );
                            }

                            if (targetTrap) {
                                const trapPos = getPos(targetTrap)!;
                                const trapAngle = Math.atan2(trapPos.y - botPos.y, trapPos.x - botPos.x);

                                bot.angle = (bot as any).targetAngle = (bot as any).dir = (bot as any).rotation = (bot as any).viewAngle = trapAngle;
                                bot.skinIndex = (STORE_HAT_MAP as any).TANK_GEAR ?? 40;
                                bot.weapons[0] = bot.weaponIndex = hammerId;

                                if (now - lastAttackTime >= 350) {
                                    lastAttackTime = now;
                                    if (typeof (bot as any).hit === "function") (bot as any).hit(trapAngle);
                                }

                                if (bot.health < 100) {
                                    bot.health = Math.min(bot.maxHealth || 100, bot.health + 40);
                                    if (typeof (bot as any).changeHealth === "function") (bot as any).changeHealth(40, bot);
                                }
                                return;
                            }

                            // 2. AUTO-HEAL (Soldier Helmet Swap)
                            if (bot.health < 80) {
                                bot.skinIndex = STORE_HAT_MAP.SOLDIER_HELMET ?? 6;
                                if (now - lastHealTime >= 120) {
                                    lastHealTime = now;
                                    bot.health = Math.min(bot.maxHealth || 100, bot.health + 40);
                                    if (typeof (bot as any).changeHealth === "function") {
                                        (bot as any).changeHealth(40, bot);
                                    }
                                }
                            }

                            // 3. TARGETING (Find Closest Enemy Player)
                            const target = PlayerManager.players
                                .filter(p => p && p.isAlive && p.sid !== bot.sid && !p.isAI && getPos(p))
                                .sort((a, b) => getDistSq(getPos(a)!, botPos) - getDistSq(getPos(b)!, botPos))[0]
                                || PlayerManager.players
                                .filter(p => p && p.isAlive && p.sid !== bot.sid && getPos(p))
                                .sort((a, b) => getDistSq(getPos(a)!, botPos) - getDistSq(getPos(b)!, botPos))[0];

                            if (!target) return;

                            const targetPos = getPos(target)!;
                            const dx = targetPos.x - botPos.x;
                            const dy = targetPos.y - botPos.y;
                            const dist = Math.hypot(dx, dy);
                            const angleToEnemy = Math.atan2(dy, dx);

                            bot.angle = (bot as any).targetAngle = (bot as any).dir = (bot as any).rotation = (bot as any).viewAngle = angleToEnemy;

                            // 4. MOVEMENT & HAT SELECTION
                            if (dist > 130) {
                                // Pursuit Mode: Booster Hat + Monkey Tail
                                if (bot.health >= 80) {
                                    bot.skinIndex = (STORE_HAT_MAP as any).BOOSTER_HAT ?? 12;
                                    (bot as any).tailIndex = 11; // Monkey Tail
                                }
                                const moveSpeed = 8.0;
                                bot.position.x += Math.cos(angleToEnemy) * moveSpeed;
                                bot.position.y += Math.sin(angleToEnemy) * moveSpeed;
                            } else {
                                // Melee Combat Orbit / Strafe
                                if (bot.health >= 80) {
                                    bot.skinIndex = (STORE_HAT_MAP as any).BULL_HELMET ?? 7;
                                    (bot as any).tailIndex = 19; // Shadow Wings
                                }
                                const orbitAngle = angleToEnemy + (Math.PI / 2 * 0.4 * strafeDirection);
                                const strafeSpeed = 4.5;
                                bot.position.x += Math.cos(orbitAngle) * strafeSpeed;
                                bot.position.y += Math.sin(orbitAngle) * strafeSpeed;
                                if (Math.random() < 0.05) strafeDirection *= -1;
                            }

                            // 5. ATTACK COMBOS (Melee Strike)
                            if (dist <= 150) {
                                bot.weapons[0] = bot.weaponIndex = katanaId;
                                if (now - lastAttackTime >= 300) {
                                    lastAttackTime = now;
                                    if (typeof (bot as any).hit === "function") {
                                        (bot as any).hit(angleToEnemy);
                                    }
                                }
                            }

                            // 6. SMART STRUCTURE PLACEMENT (Spikes & Traps)
                            if (dist <= 220 && now - lastPlaceTime >= 700) {
                                lastPlaceTime = now;
                                const placeDist = 65;
                                const placeX = botPos.x + Math.cos(angleToEnemy) * placeDist;
                                const placeY = botPos.y + Math.sin(angleToEnemy) * placeDist;
                                const isTrap = Math.random() < 0.4;
                                const placeId = isTrap ? 15 : 6;

                                if (typeof (ObjectManager as any).add === "function") {
                                    try {
                                        (ObjectManager as any).add(
                                            Math.floor(Math.random() * 100000),
                                            placeX,
                                            placeY,
                                            angleToEnemy,
                                            45,
                                            0,
                                            { id: placeId, health: 500, scale: 45 },
                                            true,
                                            bot
                                        );
                                    } catch (e) {}
                                }
                            }
                        } catch (err) {
                            console.error("Combat bot loop error:", err);
                        }
                    }, 50);

                
                //  STANDARD / BREAKER BOT LOGIC (!s, !sthb, etc.)
                
                } else {
                    if (cmdParts.includes("t")) {
                        bot.skinIndex = (STORE_HAT_MAP as any).TANK_GEAR ?? (STORE_HAT_MAP as any).TANK_HELMET ?? (STORE_HAT_MAP as any).TANK ?? 40;
                    } else if (cmdParts.filter(e => e === "s").length >= 2) {
                        bot.skinIndex = STORE_HAT_MAP.SOLDIER_HELMET;
                    }

                    if (cmdParts.includes("h")) {
                        bot.aiSettings.heal = true;
                    }

                    if (cmdParts.includes("b")) {
                        const hammerId = (WEAPON_ID_MAP as any).GREAT_HAMMER ?? (WEAPON_ID_MAP as any).TOOL_HAMMER ?? (WEAPON_ID_MAP as any).HAMMER ?? 0;
                        bot.weapons[0] = bot.weaponIndex = hammerId;

                        (bot.aiSettings as any).hit = true;
                        (bot as any).isAttacking = true;
                        (bot as any).isHitting = true;
                        (bot as any).gathering = true;

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

                                const trap = (bot as any).trap ?? (bot as any).trapObject ?? (bot as any).trapped;
                                if (trap && (trap.health === undefined || trap.health > 0) && trap.isAlive !== false) {
                                    targetPos = getPos(trap);
                                }

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

                                if (typeof (bot as any).hit === "function") {
                                    (bot as any).hit(bot.angle ?? 0);
                                } else if (typeof (bot as any).attack === "function") {
                                    (bot as any).attack(bot.angle ?? 0);
                                } else if (typeof (bot as any).gather === "function") {
                                    (bot as any).gather();
                                }
                            } catch (err) {
                                console.error("Bot loop error:", err);
                            }
                        }, hammerCooldown);
                    } else {
                        bot.weapons[0] = bot.weaponIndex = WEAPON_ID_MAP.POLEARM;
                    }
                }
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
