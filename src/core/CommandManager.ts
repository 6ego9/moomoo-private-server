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
                .filter(other => other.isAlive && other.sid !== player.sid)
                .sort((a, b) => getDistSq(a.position, player.position) - getDistSq(b.position, player.position))[0];

            if (nearest) {
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
        } else if (cmdId === "spawn" || cmdId.startsWith("s")) {
            const bot = PlayerManager.create(randString(), "Bot");
            bot.position.x = player.position.x + randInt(-500, 500);
            bot.position.y = player.position.y + randInt(-500, 500);
            bot.isAI = true;

            const cmdParts = cmdId.split("");

            // 1. Hat handling (t = Tank Gear, ss = Soldier Helmet)
            if (cmdParts.includes("t")) {
                bot.skinIndex = (STORE_HAT_MAP as any).TANK_GEAR ?? (STORE_HAT_MAP as any).TANK_HELMET ?? (STORE_HAT_MAP as any).TANK ?? 40;
            } else if (cmdParts.filter(e => e === "s").length >= 2) {
                bot.skinIndex = STORE_HAT_MAP.SOLDIER_HELMET;
            }

            // 2. Heal handling (h = Heal)
            if (cmdParts.includes("h")) {
                bot.aiSettings.heal = true;
            }

            // 3. Hammer & Continuous Hitting (b = Hammer Breaker)
            if (cmdParts.includes("b")) {
                // Equip Great Hammer or Tool Hammer
                bot.weapons[0] = bot.weaponIndex = (WEAPON_ID_MAP as any).GREAT_HAMMER ?? (WEAPON_ID_MAP as any).TOOL_HAMMER ?? (WEAPON_ID_MAP as any).HAMMER ?? 0;
                
                (bot.aiSettings as any).hit = true;
                (bot as any).isAttacking = true;
                (bot as any).isHitting = true;
                (bot as any).gathering = true;

                // Continuously trigger weapon hit every 100ms (respects weapon cooldown)
                const attackInterval = setInterval(() => {
                    if (!bot.isAlive) {
                        clearInterval(attackInterval);
                        return;
                    }

                    // Calls the attack/hit function on the Player instance
                    if (typeof (bot as any).hit === "function") {
                        (bot as any).hit(bot.angle ?? 0);
                    } else if (typeof (bot as any).attack === "function") {
                        (bot as any).attack(bot.angle ?? 0);
                    } else if (typeof (bot as any).gather === "function") {
                        (bot as any).gather();
                    }
                }, 100);
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

            if (victim) {
                player.position.x = victim.position.x;
                player.position.y = victim.position.y;
            }
        } else if (cmdId === "a") {
            ArenaManager.process(player, parsed);
        }
    }
}
