/********************************************
 * blind-control:
 *********************************************/
const path = require('path');

const hlp = require(path.join(__dirname, '/lib/dateTimeHelper.js'));
const util = require('util');

const cRuleNoTime = -1;
const cRuleUntil = 0;
const cRuleFrom = 1;
const cRuleAbsolute = 0;
const cRuleNone = 0;
const cRuleMinOversteer = 1; // ⭳❗ minimum (oversteer)
const cRuleMaxOversteer = 2; // ⭱️❗ maximum (oversteer)
const cRuleLogOperatorAnd = 2;
const cRuleLogOperatorOr = 1;
const cautoTriggerTimeBeforeSun = 10 * 60000; // 10 min
const cautoTriggerTimeSun = 5 * 60000; // 5 min
/*************************************************************************************************************************/
/**
 * check if a level has a valid value
 * @param {*} node the node data
 * @param {number} level the level to check
 * @returns {boolean} true if the level is valid, otherwise false
 */
function validPosition_(node, level, allowRound) {
    // node.debug('validPosition_ level='+level);
    if (level === '' || level === null || typeof level === 'undefined') {
        node.warn(`Position is empty!`);
        return false;
    }
    if (isNaN(level)) {
        node.warn(`Position: "${level}" is NaN!`);
        return false;
    }

    if (level < node.blindData.levelBottom) {
        if (node.levelReverse) {
            node.warn(`Position: "${level}" < open level ${node.blindData.levelBottom}`);
        } else {
            node.warn(`Position: "${level}" < closed level ${node.blindData.levelBottom}`);
        }
        return false;
    }
    if (level > node.blindData.levelTop) {
        if (node.levelReverse) {
            node.warn(`Position: "${level}" > closed level ${node.blindData.levelTop}`);
        } else {
            node.warn(`Position: "${level}" > open level ${node.blindData.levelTop}`);
        }
        return false;
    }
    if (Number.isInteger(node.blindData.levelTop) &&
        Number.isInteger(node.blindData.levelBottom) &&
        Number.isInteger(node.blindData.increment) &&
        ((level % node.blindData.increment !== 0) ||
        !Number.isInteger(level) )) {
        node.warn(`Position invalid "${level}" not fit to increment ${node.blindData.increment}`);
        return false;
    }
    if (allowRound) {
        return true;
    }
    return Number.isInteger(Number((level / node.blindData.increment).toFixed(hlp.countDecimals(node.blindData.increment) + 2)));
}
/******************************************************************************************/
/**
 * get the absolute level from percentage level
 * @param {*} node the node settings
 * @param {*} percentPos the level in percentage (0-1)
 */
function posPrcToAbs_(node, levelPercent) {
    return posRound_(node, ((node.blindData.levelTop - node.blindData.levelBottom) * levelPercent) + node.blindData.levelBottom);
}
/**
 * get the percentage level from absolute level  (0-1)
 * @param {*} node the node settings
 * @param {*} levelAbsolute the level absolute
 * @return {number} get the level percentage
 */
function posAbsToPrc_(node, levelAbsolute) {
    return (levelAbsolute - node.blindData.levelBottom) / (node.blindData.levelTop - node.blindData.levelBottom);
}
/**
 * get the absolute inverse level
 * @param {*} node the node settings
 * @param {*} levelAbsolute the level absolute
 * @return {number} get the inverse level
 */
function getInversePos_(node, level) {
    return posPrcToAbs_(node, 1 - posAbsToPrc_(node, level));
}
/**
 * get the absolute inverse level
 * @param {*} node the node settings
 * @return {number} get the current level
 */
function getRealLevel_(node) {
    if (node.levelReverse) {
        return isNaN(node.level.currentInverse) ? node.previousData.levelInverse: node.level.currentInverse;
    }
    return isNaN(node.level.current) ? node.previousData.level : node.level.current;
}

/**
 * round a level to the next increment
 * @param {*} node node data
 * @param {number} pos level
 * @return {number} rounded level number
 */
function posRound_(node, pos) {
    // node.debug(`levelPrcToAbs_ ${pos} - increment is ${node.blindData.increment}`);
    // pos = Math.ceil(pos / node.blindData.increment) * node.blindData.increment;
    // pos = Math.floor(pos / node.blindData.increment) * node.blindData.increment;
    pos = Math.round(pos / node.blindData.increment) * node.blindData.increment;
    pos = Number(pos.toFixed(hlp.countDecimals(node.blindData.increment)));
    if (pos > node.blindData.levelTop) {
        pos = node.blindData.levelTop;
    }
    if (pos < node.blindData.levelBottom) {
        pos = node.blindData.levelBottom;
    }
    // node.debug(`levelPrcToAbs_ result ${pos}`);
    return pos;
}

/**
 * normalizes an angle
 * @param {number} angle to normalize
 */
function angleNorm_(angle) {
    while (angle < 0) {
        angle += 360;
    }
    while (angle > 360) {
        angle -= 360;
    }
    return angle;
}
/******************************************************************************************/
/**
 * calculates the current sun level
 * @param {*} node node data
 * @param {*} now the current timestamp
 */
function getSunPosition_(node, now) {
    const sunPosition = node.positionConfig.getSunCalc(now, false, false);
    // node.debug('sunPosition: ' + util.inspect(sunPosition, { colors: true, compact: 10, breakLength: Infinity }));
    sunPosition.InWindow = (sunPosition.azimuthDegrees >= node.windowSettings.AzimuthStart) &&
                           (sunPosition.azimuthDegrees <= node.windowSettings.AzimuthEnd);
    // node.debug(`sunPosition: InWindow=${sunPosition.InWindow} azimuthDegrees=${sunPosition.azimuthDegrees} AzimuthStart=${node.windowSettings.AzimuthStart} AzimuthEnd=${node.windowSettings.AzimuthEnd}`);
    if (node.autoTrigger ) {
        if ((sunPosition.altitudeDegrees <= 0) || (node.sunData.minAltitude && (sunPosition.altitudeDegrees < node.sunData.minAltitude))) {
            node.autoTrigger.type = 3; // Sun not on horizon
        } else if (sunPosition.azimuthDegrees <= 72) {
            node.autoTrigger.type = 4; // Sun not visible
        } else if (sunPosition.azimuthDegrees <= node.windowSettings.AzimuthStart) {
            node.autoTrigger.time = Math.min(node.autoTrigger.time, cautoTriggerTimeBeforeSun);
            node.autoTrigger.type = 5; // sun before in window
        } else if (sunPosition.azimuthDegrees <= node.windowSettings.AzimuthEnd) {
            if (node.smoothTime > 0) {
                node.autoTrigger.time = Math.min(node.autoTrigger.time, node.smoothTime);
                node.autoTrigger.type = 6; // sun in window (smooth time set)
            } else {
                node.autoTrigger.time = Math.min(node.autoTrigger.time, (cautoTriggerTimeSun));
                node.autoTrigger.type = 7; // sun in window
            }
        }
    }
    return sunPosition;
}

module.exports = function (RED) {
    'use strict';
    /**
     * evaluate temporary Data
     * @param {*} node   node Data
     * @param {string} type  type of type input
     * @param {string} value  value of typeinput
     * @param {*} data  data to cache
     * @returns {*}  data which was cached
     */
    function evalTempData(node, type, value, data, tempData) {
        // node.debug(`evalTempData type=${type} value=${value} data=${data}`);
        const name = `${type}.${value}`;
        if (data === null || typeof data === 'undefined') {
            if (typeof tempData[name] !== 'undefined') {
                if (type !== 'PlT') {
                    node.log(RED._('blind-control.errors.usingTempValue', { type, value, usedValue: tempData[name] }));
                }
                return tempData[name];
            }
            if (node.nowarn[name]) {
                return undefined; // only one error per run
            }
            node.warn(RED._('blind-control.errors.warning', { message: RED._('blind-control.errors.notEvaluableProperty', { type, value, usedValue: 'undefined' }) }));
            node.nowarn[name] = true;
            return undefined;
        }
        tempData[name] = data;
        return data;
    }

    /******************************************************************************************/
    /**
     * check the oversteering data
     * @param {*} node node data
     * @param {*} msg the message object
     */
    function checkOversteer(node, msg, tempData) {
        // node.debug('checkOversteer');
        try {
            node.oversteer.isChecked = true;
            return node.oversteerData.find(el => node.positionConfig.comparePropValue(node, msg,
                {
                    value: el.operand.value,
                    type: el.operand.type,
                    callback: (result, _obj) => {
                        return evalTempData(node, _obj.type, _obj.value, result, tempData);
                    }
                },
                el.operator,
                {
                    value: el.threshold.value,
                    type: el.threshold.type,
                    callback: (result, _obj) => {
                        return evalTempData(node, _obj.type, _obj.value, result, tempData);
                    }
                }));
        } catch (err) {
            node.error(RED._('blind-control.errors.getOversteerData', err));
            node.log(util.inspect(err, Object.getOwnPropertyNames(err)));
        }
        // node.debug('node.oversteerData=' + util.inspect(node.oversteerData, { colors: true, compact: 10, breakLength: Infinity }));
        return undefined;
    }
    /******************************************************************************************/
    /**
     * get the blind level from a typed input
     * @param {*} node node data
     * @param {*} type type field
     * @param {*} value value field
     * @returns blind level as number or NaN if not defined
     */
    function getBlindPosFromTI(node, msg, type, value, def) {
        // node.debug(`getBlindPosFromTI - type=${type} value=${value} def=${def} blindData=${ util.inspect(node.blindData, { colors: true, compact: 10, breakLength: Infinity }) }`);
        def = def || NaN;
        if (type === 'none' || type === ''|| type === 'levelND') {
            return def;
        }
        try {
            if (type === 'levelFixed') {
                const val = parseFloat(value);
                if (isNaN(val)) {
                    if (value.includes('close')) {
                        return node.blindData.levelBottom;
                    } else if (value.includes('open')) {
                        return node.blindData.levelTop;
                    } else if (val === '') {
                        return def;
                    }
                } else {
                    if (val < 1) {
                        return node.blindData.levelBottom;
                    } else if (val > 99) {
                        return node.blindData.levelTop;
                    }
                    return posPrcToAbs_(node, val / 100);
                }
                throw new Error(`unknown value "${value}" of type "${type}"` );
            }
            const res = node.positionConfig.getFloatProp(node, msg, type, value, def);
            if (node.levelReverse) {
                return getInversePos_(node, res);
            }
            return res;
        } catch (err) {
            node.error(RED._('blind-control.errors.getBlindPosData', err));
            node.log(util.inspect(err, Object.getOwnPropertyNames(err)));
        }
        return def;
    }
    /******************************************************************************************/
    /**
     * reset any existing override
     * @param {*} node node data
     */
    function blindPosOverwriteReset(node) {
        node.debug(`blindPosOverwriteReset expire=${node.blindData.overwrite.expireTs}`);
        node.blindData.overwrite.active = false;
        node.blindData.overwrite.importance = 0;
        if (node.timeOutObj) {
            clearTimeout(node.timeOutObj);
            node.timeOutObj = null;
        }
        if (node.blindData.overwrite.expireTs || node.blindData.overwrite.expires) {
            delete node.blindData.overwrite.expires;
            delete node.blindData.overwrite.expireTs;
            delete node.blindData.overwrite.expireDate;
            delete node.blindData.overwrite.expireDateISO;
            delete node.blindData.overwrite.expireDateUTC;
            delete node.blindData.overwrite.expireTimeLocal;
            delete node.blindData.overwrite.expireDateLocal;
        }
    }

    /**
     * setup the expiring of n override or update an existing expiring
     * @param {*} node node data
     * @param {Date} dNow the current timestamp
     * @param {number} dExpire the expiring time, (if it is NaN, default time will be tried to use) if it is not used, nor a Number or less than 1 no expiring activated
     */
    function setExpiringOverwrite(node, dNow, dExpire, reason) {
        node.debug(`setExpiringOverwrite now=${dNow}, dExpire=${dExpire}, reason=${reason}`);
        if (node.timeOutObj) {
            clearTimeout(node.timeOutObj);
            node.timeOutObj = null;
        }

        if (isNaN(dExpire)) {
            dExpire = node.blindData.overwrite.expireDuration;
            node.debug(`using default expire value=${dExpire}`);
        }
        node.blindData.overwrite.expires = Number.isFinite(dExpire) && (dExpire > 0);

        if (!node.blindData.overwrite.expires) {
            node.log(`Overwrite is set which never expire (${reason})`);
            node.debug(`expireNever expire=${dExpire}ms ${  typeof dExpire  } - isNaN=${  isNaN(dExpire)  } - finite=${  !isFinite(dExpire)  } - min=${  dExpire < 100}}`);
            delete node.blindData.overwrite.expireTs;
            delete node.blindData.overwrite.expireDate;
            return;
        }
        node.blindData.overwrite.expireTs = (dNow.getTime() + dExpire);
        node.blindData.overwrite.expireDate = new Date(node.blindData.overwrite.expireTs);
        node.blindData.overwrite.expireDateISO = node.blindData.overwrite.expireDate.toISOString();
        node.blindData.overwrite.expireDateUTC = node.blindData.overwrite.expireDate.toUTCString();
        node.blindData.overwrite.expireDateLocal = node.positionConfig.toDateString(node.blindData.overwrite.expireDate);
        node.blindData.overwrite.expireTimeLocal = node.positionConfig.toTimeString(node.blindData.overwrite.expireDate);

        node.log(`Overwrite is set which expires in ${dExpire}ms = ${node.blindData.overwrite.expireDateISO} (${reason})`);
        node.timeOutObj = setTimeout(() => {
            node.log(`Overwrite is expired (timeout)`);
            blindPosOverwriteReset(node);
            node.emit('input', { payload: -1, topic: 'internal-triggerOnly-overwriteExpired', force: false });
        }, dExpire);
    }

    /**
     * check if an override can be reset
     * @param {*} node node data
     * @param {*} msg message object
     * @param {*} dNow current timestamp
     */
    function checkOverrideReset(node, msg, dNow, isSignificant) {
        if (node.blindData.overwrite &&
            node.blindData.overwrite.expires &&
            (node.blindData.overwrite.expireTs < dNow.getTime())) {
            node.log(`Overwrite is expired (trigger)`);
            blindPosOverwriteReset(node);
        }
        if (isSignificant) {
            hlp.getMsgBoolValue(msg, ['reset','resetOverwrite'], 'resetOverwrite',
                val => {
                    node.debug(`reset val="${util.inspect(val, { colors: true, compact: 10, breakLength: Infinity })  }"`);
                    if (val) {
                        if (node.blindData.overwrite && node.blindData.overwrite.active) {
                            node.log(`Overwrite reset by incoming message`);
                        }
                        blindPosOverwriteReset(node);
                    }
                });
        }
    }
    /**
     * setting the reason for override
     * @param {*} node node data
     */
    function setOverwriteReason(node) {
        if (node.blindData.overwrite.active) {
            if (node.blindData.overwrite.expireTs) {
                node.reason.code = 3;
                const obj = {
                    importance: node.blindData.overwrite.importance,
                    timeLocal: node.blindData.overwrite.expireTimeLocal,
                    dateLocal: node.blindData.overwrite.expireDateLocal,
                    dateISO: node.blindData.overwrite.expireDateISO,
                    dateUTC: node.blindData.overwrite.expireDateUTC
                };
                node.reason.state = RED._('blind-control.states.overwriteExpire', obj);
                node.reason.description = RED._('blind-control.reasons.overwriteExpire', obj);
            } else {
                node.reason.code = 2;
                node.reason.state = RED._('blind-control.states.overwriteNoExpire', { importance: node.blindData.overwrite.importance });
                node.reason.description = RED._('blind-control.states.overwriteNoExpire', { importance: node.blindData.overwrite.importance });
            }
            // node.debug(`overwrite exit true node.blindData.overwrite.active=${node.blindData.overwrite.active}`);
            return true;
        }
        // node.debug(`overwrite exit true node.blindData.overwrite.active=${node.blindData.overwrite.active}`);
        return false;
    }

    /**
     * check if a manual overwrite of the blind level should be set
     * @param {*} node node data
     * @param {*} msg message object
     * @returns true if override is active, otherwise false
     */
    function checkBlindPosOverwrite(node, msg, dNow) {
        node.debug(`checkBlindPosOverwrite act=${node.blindData.overwrite.active} `);
        let isSignificant = false;
        const exactImportance = hlp.getMsgBoolValue(msg, ['exactImportance', 'exactSignificance', 'exactPriority', 'exactPrivilege'], ['exactImporta', 'exactSignifican', 'exactPrivilege', 'exactPrio']);
        const nImportance = hlp.getMsgNumberValue(msg, ['importance', 'significance', 'prio', 'priority', 'privilege'], ['importa', 'significan', 'prio', 'alarm', 'privilege'], p => {
            if (exactImportance) {
                isSignificant = (node.blindData.overwrite.importance === p);
            } else {
                isSignificant = (node.blindData.overwrite.importance <= p);
            }
            checkOverrideReset(node, msg, dNow, isSignificant);
            return p;
        }, () => {
            checkOverrideReset(node, msg, dNow, true);
            return 0;
        });

        if (node.blindData.overwrite.active && (node.blindData.overwrite.importance > 0) && !isSignificant) {
            // if (node.blindData.overwrite.active && (node.blindData.overwrite.importance > 0) && (node.blindData.overwrite.importance > importance)) {
            // node.debug(`overwrite exit true node.blindData.overwrite.active=${node.blindData.overwrite.active}, importance=${importance}, node.blindData.overwrite.importance=${node.blindData.overwrite.importance}`);
            // if active, the importance must be 0 or given with same or higher as current overwrite otherwise this will not work
            node.debug(`do not check any overwrite, importance of message ${nImportance} not matches current overwrite importance ${node.blindData.overwrite.importance}`);
            return setOverwriteReason(node);
        }
        const onlyTrigger = hlp.getMsgBoolValue(msg, ['trigger', 'noOverwrite'], ['triggerOnly', 'noOverwrite']);
        let newPos = hlp.getMsgNumberValue(msg, ['blindPosition', 'position', 'level', 'blindLevel'], ['manual', 'levelOverwrite']);
        let nExpire = hlp.getMsgNumberValue(msg, 'expire', 'expire');
        if (msg.topic && String(msg.topic).includes('noExpir')) {
            nExpire = -1;
        }
        if (!onlyTrigger && node.blindData.overwrite.active && isNaN(newPos)) {
            node.debug(`overwrite active, check of nImportance=${nImportance} or nExpire=${nExpire}, newPos=${newPos}`);
            if (Number.isFinite(nExpire)) {
                node.debug(`set to new expiring time nExpire="${nExpire}"`);
                // set to new expiring time
                setExpiringOverwrite(node, dNow, nExpire, 'set new expiring time by message');
            }
            if (nImportance > 0) {
                // set to new importance
                node.blindData.overwrite.importance = nImportance;
            }
            // node.debug(`overwrite exit true node.blindData.overwrite.active=${node.blindData.overwrite.active}, newPos=${newPos}, expire=${expire}`);
            return setOverwriteReason(node);
        } else if (!onlyTrigger && !isNaN(newPos)) {
            node.debug(`needOverwrite nImportance=${nImportance} nExpire=${nExpire} newPos=${newPos}`);
            if (newPos === -1) {
                node.level.current = NaN;
                node.level.currentInverse = NaN;
            } else if (!isNaN(newPos)) {
                const allowRound = (msg.topic ? (msg.topic.includes('roundLevel') || msg.topic.includes('roundLevel')) : false);
                if (!validPosition_(node, newPos, allowRound)) {
                    node.error(RED._('blind-control.errors.invalid-blind-level', { pos: newPos }));
                    return false;
                }
                if (allowRound) {
                    newPos = posRound_(node, newPos);
                }
                node.debug(`overwrite newPos=${newPos}`);
                const noSameValue = hlp.getMsgBoolValue(msg, 'ignoreSameValue');
                if (noSameValue && (node.previousData.level === newPos)) {
                    node.debug(`overwrite exit true noSameValue=${noSameValue}, newPos=${newPos}`);
                    return setOverwriteReason(node);
                }
                node.level.current = newPos;
                node.level.currentInverse = newPos;
                node.level.topic = msg.topic;
            }

            if (Number.isFinite(nExpire) || (nImportance <= 0)) {
                // will set expiring if importance is 0 or if expire is explizit defined
                node.debug(`set expiring - expire is explizit defined "${nExpire}"`);
                setExpiringOverwrite(node, dNow, nExpire, 'set expiring time by message');
            } else if ((!exactImportance && (node.blindData.overwrite.importance < nImportance)) || (!node.blindData.overwrite.expireTs)) {
                // isSignificant
                // no expiring on importance change or no existing expiring
                node.debug(`no expire defined, using default or will not expire`);
                setExpiringOverwrite(node, dNow, NaN, 'no special expire defined');
            }
            if (nImportance > 0) {
                node.blindData.overwrite.importance = nImportance;
            }
            node.blindData.overwrite.active = true;
        }
        // node.debug(`overwrite exit node.blindData.overwrite.active=${node.blindData.overwrite.active}`);
        return setOverwriteReason(node);
    }

    /******************************************************************************************/
    /**
     * calculates for the blind the new level
     * @param {*} node the node data
     * @param {*} msg the message object
     * @returns the sun position object
     */
    function calcBlindSunPosition(node, msg, dNow, tempData) {
        // node.debug('calcBlindSunPosition: calculate blind position by sun');
        // sun control is active
        const sunPosition = getSunPosition_(node, dNow);
        const winterMode = 1;
        const summerMode = 2;

        if (!sunPosition.InWindow) {
            if (node.sunData.mode === winterMode) {
                node.level.current = node.blindData.levelMin;
                node.level.currentInverse = getInversePos_(node, node.level.current);
                node.level.topic = node.sunData.topic;
                node.reason.code = 13;
                node.reason.state = RED._('blind-control.states.sunNotInWinMin');
                node.reason.description = RED._('blind-control.reasons.sunNotInWin');
            } else {
                node.reason.code = 8;
                node.reason.state = RED._('blind-control.states.sunNotInWin');
                node.reason.description = RED._('blind-control.reasons.sunNotInWin');
            }
            return sunPosition;
        }

        if ((node.sunData.mode === summerMode) && node.sunData.minAltitude && (sunPosition.altitudeDegrees < node.sunData.minAltitude)) {
            node.reason.code = 7;
            node.reason.state = RED._('blind-control.states.sunMinAltitude');
            node.reason.description = RED._('blind-control.reasons.sunMinAltitude');
            return sunPosition;
        }

        if (node.oversteer.active) {
            const res = checkOversteer(node, msg, tempData);
            if (res) {
                node.level.current = res.blindPos;
                node.level.currentInverse = getInversePos_(node, node.level.current);
                node.level.topic = node.oversteer.topic;
                node.reason.code = 10;
                node.reason.state = RED._('blind-control.states.oversteer');
                node.reason.description = RED._('blind-control.reasons.oversteer');
                sunPosition.oversteer = res;
                sunPosition.oversteerAll = node.oversteerData;
                return sunPosition;
            }
            sunPosition.oversteerAll = node.oversteerData;
        }

        if (node.sunData.mode === winterMode) {
            node.level.current = node.blindData.levelMax;
            node.level.currentInverse = getInversePos_(node, node.level.current);
            node.level.topic = node.sunData.topic;
            node.reason.code = 12;
            node.reason.state = RED._('blind-control.states.sunInWinMax');
            node.reason.description = RED._('blind-control.reasons.sunInWinMax');
            return sunPosition;
        }

        // node.debug('node.windowSettings: ' + util.inspect(node.windowSettings, { colors: true, compact: 10 }));
        const height = Math.tan(sunPosition.altitudeRadians) * node.sunData.floorLength;
        // node.debug(`height=${height} - altitude=${sunPosition.altitudeRadians} - floorLength=${node.sunData.floorLength}`);
        if (height <= node.windowSettings.bottom) {
            node.level.current = node.blindData.levelBottom;
            node.level.currentInverse = node.blindData.levelTop;
            node.level.topic = node.sunData.topic;
        } else if (height >= node.windowSettings.top) {
            node.level.current = node.blindData.levelTop;
            node.level.currentInverse = node.blindData.levelBottom;
            node.level.topic = node.sunData.topic;
        } else {
            node.level.current = posPrcToAbs_(node, (height - node.windowSettings.bottom) / (node.windowSettings.top - node.windowSettings.bottom));
            node.level.currentInverse = getInversePos_(node, node.level.current);
            node.level.topic = node.sunData.topic;
        }

        const delta = Math.abs(node.previousData.level - node.level.current);

        if ((node.smoothTime > 0) && (node.sunData.changeAgain > dNow.getTime())) {
            node.debug(`no change smooth - smoothTime= ${node.smoothTime}  changeAgain= ${node.sunData.changeAgain}`);
            node.reason.code = 11;
            node.reason.state = RED._('blind-control.states.smooth', { pos: getRealLevel_(node).toString()});
            node.reason.description = RED._('blind-control.reasons.smooth', { pos: getRealLevel_(node).toString()});
            node.level.current = node.previousData.level;
            node.level.currentInverse = node.previousData.levelInverse;
            node.level.topic = node.previousData.topic;
        } else if ((node.sunData.minDelta > 0) && (delta < node.sunData.minDelta) && (node.level.current > node.blindData.levelBottom) && (node.level.current < node.blindData.levelTop)) {
            node.reason.code = 14;
            node.reason.state = RED._('blind-control.states.sunMinDelta', { pos: getRealLevel_(node).toString()});
            node.reason.description = RED._('blind-control.reasons.sunMinDelta', { pos: getRealLevel_(node).toString() });
            node.level.current = node.previousData.level;
            node.level.currentInverse = node.previousData.levelInverse;
            node.level.topic = node.previousData.topic;
        } else {
            node.reason.code = 9;
            node.reason.state = RED._('blind-control.states.sunCtrl');
            node.reason.description = RED._('blind-control.reasons.sunCtrl');
            node.sunData.changeAgain = dNow.getTime() + node.smoothTime;
            // node.debug(`set next time - smoothTime= ${node.smoothTime}  changeAgain= ${node.sunData.changeAgain} now=` + dNow.getTime());
        }
        if (node.level.current < node.blindData.levelMin)  {
            // min
            node.debug(`${node.level.current} is below ${node.blindData.levelMin} (min)`);
            node.reason.code = 5;
            node.reason.state = RED._('blind-control.states.sunCtrlMin', {org: node.reason.state});
            node.reason.description = RED._('blind-control.reasons.sunCtrlMin', {org: node.reason.description, level:node.level.current});
            node.level.current = node.blindData.levelMin;
            node.level.currentInverse = getInversePos_(node, node.level.current); // node.blindData.levelMax;
        } else if (node.level.current > node.blindData.levelMax) {
            // max
            node.debug(`${node.level.current} is above ${node.blindData.levelMax} (max)`);
            node.reason.code = 6;
            node.reason.state = RED._('blind-control.states.sunCtrlMax', {org: node.reason.state});
            node.reason.description = RED._('blind-control.reasons.sunCtrlMax', {org: node.reason.description, level:node.level.current});
            node.level.current = node.blindData.levelMax;
            node.level.currentInverse = getInversePos_(node, node.level.current); // node.blindData.levelMin;
        }
        // node.debug(`calcBlindSunPosition end pos=${node.level.current} reason=${node.reason.code} description=${node.reason.description}`);
        return sunPosition;
    }
    /******************************************************************************************/
    /**
     * pre-checking conditions to may be able to store temp data
     * @param {*} node node data
     * @param {*} msg the message object
     * @param {*} tempData the temporary storage object
     */
    function prepareRules(node, msg, tempData) {
        for (let i = 0; i < node.rules.count; ++i) {
            const rule = node.rules.data[i];
            if (rule.conditional) {
                rule.conditon = {
                    result : false
                };
                for (let i = 0; i < rule.conditonData.length; i++) {
                    console.log(i);
                    const el = rule.conditonData[i];
                    if (rule.conditon.result === true && el.condition.value === cRuleLogOperatorOr) {
                        console.log('break1');
                        console.log(util.inspect(el, Object.getOwnPropertyNames(rule)));
                        break; // not nessesary, becaue already tue
                    }
                    delete el.operandValue;
                    delete el.thresholdValue;
                    el.result = node.positionConfig.comparePropValue(node, msg,
                        {
                            value: el.operand.value,
                            type: el.operand.type,
                            callback: (result, _obj) => { // opCallback
                                el.operandValue = _obj.value;
                                return evalTempData(node, _obj.type, _obj.value, result, tempData);
                            }
                        },
                        el.operator.value,
                        {
                            value: el.threshold.value,
                            type: el.threshold.type,
                            callback: (result, _obj) => { // opCallback
                                el.thresholdValue = _obj.value;
                                return evalTempData(node, _obj.type, _obj.value, result, tempData);
                            }
                        }
                    );
                    console.log(util.inspect(el, Object.getOwnPropertyNames(rule)));
                    if (el.result === false) {
                        if (el.condition.value === cRuleLogOperatorAnd) {
                            console.log('break2');
                            rule.conditon.result = false;
                            break; // and should not evaluate anymore
                        }
                        continue; // maybe next is true
                    }
                    rule.conditon = {
                        index : i,
                        result : el.result,
                        text : el.text,
                        textShort : el.textShort
                    };
                    if (typeof el.thresholdValue !== 'undefined') {
                        rule.conditon.text += ' ' + el.thresholdValue;
                        rule.conditon.textShort += ' ' + hlp.clipStrLength(el.thresholdValue, 10);
                    }
                }
                console.log('result');
                console.log(util.inspect(rule, Object.getOwnPropertyNames(rule)));
            }
        }
    }

    /**
     * get time constrainty of a rule
     * @param {*} node node data
     * @param {*} msg the message object
     * @param {*} rule the rule data
     * @return {number} timestamp of the rule
     */
    function getRuleTimeData(node, msg, rule, now) {
        rule.timeData = node.positionConfig.getTimeProp(node, msg, {
            type: rule.timeType,
            value : rule.timeValue,
            offsetType : rule.offsetType,
            offset : rule.offsetValue,
            multiplier : rule.multiplier,
            next : false,
            now
        });
        if (rule.timeData.error) {
            hlp.handleError(node, RED._('blind-control.errors.error-time', { message: rule.timeData.error }), undefined, rule.timeData.error);
            return -1;
        } else if (!rule.timeData.value) {
            throw new Error('Error can not calc time!');
        }
        rule.timeData.source = 'Default';
        rule.timeData.ts = rule.timeData.value.getTime();
        rule.timeData.dayId = hlp.getDayId(rule.timeData.value);
        if (rule.timeMinType !== 'none') {
            rule.timeDataMin = node.positionConfig.getTimeProp(node, msg, {
                type: rule.timeMinType,
                value: rule.timeMinValue,
                offsetType: rule.offsetMinType,
                offset: rule.offsetMinValue,
                multiplier: rule.multiplierMin,
                next: false,
                now
            });
            const numMin = rule.timeDataMin.value.getTime();
            rule.timeDataMin.source = 'Min';
            if (rule.timeDataMin.error) {
                hlp.handleError(node, RED._('blind-control.errors.error-time', { message: rule.timeDataMin.error }), undefined, rule.timeDataAlt.error);
            } else if (!rule.timeDataMin.value) {
                throw new Error('Error can not calc Alt time!');
            } else {
                if (numMin > rule.timeData.ts) {
                    const tmp = rule.timeData;
                    rule.timeData = rule.timeDataMin;
                    rule.timeDataMin = tmp;
                    rule.timeData.ts = numMin;
                    rule.timeData.dayId = hlp.getDayId(rule.timeDataMin.value);
                }
            }
        }
        if (rule.timeMaxType !== 'none') {
            rule.timeDataMax = node.positionConfig.getTimeProp(node, msg, {
                type: rule.timeMaxType,
                value: rule.timeMaxValue,
                offsetType: rule.offsetMaxType,
                offset: rule.offsetMaxValue,
                multiplier: rule.multiplierMax,
                next: false,
                now
            });
            const numMax = rule.timeDataMax.value.getTime();
            rule.timeDataMax.source = 'Max';
            if (rule.timeDataMax.error) {
                hlp.handleError(node, RED._('blind-control.errors.error-time', { message: rule.timeDataMax.error }), undefined, rule.timeDataAlt.error);
            } else if (!rule.timeDataMax.value) {
                throw new Error('Error can not calc Alt time!');
            } else {
                if (numMax < rule.timeData.ts) {
                    const tmp = rule.timeData;
                    rule.timeData = rule.timeDataMax;
                    rule.timeDataMax = tmp;
                    rule.timeData.ts = numMax;
                    rule.timeData.dayId = hlp.getDayId(rule.timeDataMax.value);
                }
            }
        }
        return rule.timeData.ts;
    }

    /**
     * check all rules and determinate the active rule
     * @param {Object} node node data
     * @param {Object} msg the message object
     * @param {Date} dNow the *current* date Object
     * @param {Object} tempData the object storing the temporary caching data
     * @returns the active rule or null
     */
    function checkRules(node, msg, dNow, tempData) {
        // node.debug('checkRules --------------------');
        const livingRuleData = {};
        const nowNr = dNow.getTime();
        const dayNr = dNow.getDay();
        const dateNr = dNow.getDate();
        const monthNr = dNow.getMonth();
        const dayId =  hlp.getDayId(dNow);
        prepareRules(node, msg, tempData);
        // node.debug(`checkRules nowNr=${nowNr}, rules.count=${node.rules.count}, rules.lastUntil=${node.rules.lastUntil}`); // {colors:true, compact:10}

        /**
        * Timestamp compare function
        * @name ICompareTimeStamp
        * @function
        * @param {number} timeStamp The timestamp which should be compared
        * @returns {Boolean} return true if if the timestamp is valid, otherwise false
        */

        /**
         * function to check a rule
         * @param {object} rule a rule object to test
         * @param {ICompareTimeStamp} cmp a function to compare two timestamps.
         * @returns {Object|null} returns the rule if rule is valid, otherwhise null
         */
        const fktCheck = (rule, cmp) => {
            // node.debug('rule ' + util.inspect(rule, {colors:true, compact:10}));
            if (rule.conditional) {
                try {
                    if (!rule.conditon.result) {
                        return null;
                    }
                } catch (err) {
                    node.warn(RED._('blind-control.errors.getPropertyData', err));
                    node.debug(util.inspect(err, Object.getOwnPropertyNames(err)));
                    return null;
                }
            }
            if (!rule.timeLimited) {
                return rule;
            }
            if (rule.timeDays && rule.timeDays !== '*' && !rule.timeDays.includes(dayNr)) {
                return null;
            }
            if (rule.timeMonths && rule.timeMonths !== '*' && !rule.timeMonths.includes(monthNr)) {
                return null;
            }
            if (rule.timeOnlyOddDays && (dateNr % 2 === 0)) { // even
                return null;
            }
            if (rule.timeOnlyEvenDays && (dateNr % 2 !== 0)) { // odd
                return null;
            }
            if (rule.timeDateStart || rule.timeDateEnd) {
                rule.timeDateStart.setFullYear(dNow.getFullYear());
                rule.timeDateEnd.setFullYear(dNow.getFullYear());
                if (rule.timeDateEnd > rule.timeDateStart) {
                    // in the current year
                    if (dNow < rule.timeDateStart || dNow > rule.timeDateEnd) {
                        return null;
                    }
                } else {
                    // switch between year from end to start
                    if (dNow < rule.timeDateStart && dNow > rule.timeDateEnd) {
                        return null;
                    }
                }
            }
            const num = getRuleTimeData(node, msg, rule, dNow);
            // node.debug(`pos=${rule.pos} type=${rule.timeOpText} - ${rule.timeValue} - rule.timeData = ${ util.inspect(rule.timeData, { colors: true, compact: 40, breakLength: Infinity }) }`);
            if (dayId === rule.timeData.dayId && num >=0 && (cmp(num) === true)) {
                return rule;
            }
            return null;
        };

        let ruleSel = null;
        let ruleSelMin = null;
        let ruleSelMax = null;
        let ruleindex = -1;
        // node.debug('first loop ' + node.rules.count);
        for (let i = 0; i < node.rules.count; ++i) { //  node.rules.lastUntil
            const rule = node.rules.data[i];
            // node.debug('rule ' + rule.timeOp + ' - ' + (rule.timeOp !== cRuleFrom) + ' - ' + util.inspect(rule, {colors:true, compact:10, breakLength: Infinity }));
            if (rule.timeOp === cRuleFrom) { continue; }
            // const res = fktCheck(rule, r => (r >= nowNr));
            let res = null;
            if (rule.timeOp === cRuleFrom) {
                res = fktCheck(rule, r => (r <= nowNr));
            } else {
                res = fktCheck(rule, r => (r >= nowNr));
            }
            if (res) {
                // node.debug('1. ruleSel ' + util.inspect(res, { colors: true, compact: 10, breakLength: Infinity }));
                if (res.levelOp === cRuleMinOversteer) {
                    ruleSelMin = res;
                } else if (res.levelOp === cRuleMaxOversteer) {
                    ruleSelMax = res;
                } else {
                    ruleSel = res;
                    ruleindex = i;
                    if (rule.timeOp !== cRuleFrom) {
                        break;
                    }
                }
            }
        }

        if (!ruleSel || (ruleSel.timeOp === cRuleFrom) ) {
            // node.debug('--------- starting second loop ' + node.rules.count);
            for (let i = (node.rules.count - 1); i >= 0; --i) {
                const rule = node.rules.data[i];
                // node.debug('rule ' + rule.timeOp + ' - ' + (rule.timeOp !== cRuleUntil) + ' - ' + util.inspect(rule, {colors:true, compact:10, breakLength: Infinity }));
                if (rule.timeOp === cRuleUntil) { continue; } // - From: timeOp === cRuleFrom
                const res = fktCheck(rule, r => (r <= nowNr));
                if (res) {
                    // node.debug('2. ruleSel ' + util.inspect(res, { colors: true, compact: 10, breakLength: Infinity }));
                    if (res.levelOp === cRuleMinOversteer) {
                        ruleSelMin = res;
                    } else if (res.levelOp === cRuleMaxOversteer) {
                        ruleSelMax = res;
                    } else {
                        ruleSel = res;
                        break;
                    }
                }
            }
        }

        livingRuleData.hasMinimum = false;
        if (ruleSelMin) {
            const lev = getBlindPosFromTI(node, msg, ruleSelMin.levelType, ruleSelMin.levelValue, -1);
            // node.debug('ruleSelMin ' + lev + ' -- ' + util.inspect(ruleSelMin, { colors: true, compact: 10, breakLength: Infinity }));
            if (lev > -1) {
                livingRuleData.levelMinimum = lev;
                livingRuleData.hasMinimum = true;
                livingRuleData.minimum = {
                    id: ruleSelMin.pos,
                    name: ruleSelMin.name,
                    conditional: ruleSelMin.conditional,
                    timeLimited: ruleSelMin.timeLimited,
                    conditon: ruleSelMin.conditon,
                    time: ruleSelMin.timeData
                };
            }
        }
        livingRuleData.hasMaximum = false;
        if (ruleSelMax) {
            const lev = getBlindPosFromTI(node, msg, ruleSelMax.levelType, ruleSelMax.levelValue, -1);
            // node.debug('ruleSelMax ' + lev + ' -- ' + util.inspect(ruleSelMax, { colors: true, compact: 10, breakLength: Infinity }) );
            if (lev > -1) {
                livingRuleData.levelMaximum = lev;
                livingRuleData.hasMaximum = true;
                livingRuleData.maximum = {
                    id: ruleSelMax.pos,
                    name: ruleSelMax.name,
                    conditional: ruleSelMax.conditional,
                    timeLimited: ruleSelMax.timeLimited,
                    conditon: ruleSelMax.conditon,
                    time: ruleSelMax.timeData
                };
            }
        }
        if (ruleSel) {
            if (node.autoTrigger) {
                if (ruleSel.timeLimited && ruleSel.timeData.ts > nowNr) {
                    const diff = ruleSel.timeData.ts - nowNr;
                    node.autoTrigger.time = Math.min(node.autoTrigger.time, diff);
                    node.autoTrigger.type = 1; // current rule end
                } else {
                    for (let i = (ruleindex+1); i < node.rules.count; ++i) {
                        const rule = node.rules.data[i];
                        if (!rule.timeLimited) {
                            continue;
                        }
                        const num = getRuleTimeData(node, msg, rule, dNow);
                        if (num > nowNr) {
                            const diff = num - nowNr;
                            node.autoTrigger.time = Math.min(node.autoTrigger.time, diff);
                            node.autoTrigger.type = 2; // next rule
                        }
                    }
                }
            }
            // ruleSel.text = '';
            // node.debug('ruleSel ' + util.inspect(ruleSel, {colors:true, compact:10, breakLength: Infinity }));
            livingRuleData.id = ruleSel.pos;
            livingRuleData.name = ruleSel.name;
            node.reason.code = 4;

            if (ruleSel.levelOp === cRuleAbsolute) { // absolute rule
                livingRuleData.level = getBlindPosFromTI(node, msg, ruleSel.levelType, ruleSel.levelValue, -1);
                livingRuleData.active = (livingRuleData.level > -1);
            } else {
                livingRuleData.active = false;
                livingRuleData.level = node.blindData.levelDefault;
            }

            livingRuleData.conditional = ruleSel.conditional;
            livingRuleData.timeLimited = ruleSel.timeLimited;
            node.level.current = livingRuleData.level;
            node.level.currentInverse = getInversePos_(node, livingRuleData.level);
            node.level.topic = livingRuleData.topic;
            const data = { number: ruleSel.pos, name: ruleSel.name };
            let name = 'rule';
            if (ruleSel.conditional) {
                livingRuleData.conditon = ruleSel.conditon;
                data.text = ruleSel.conditon.text;
                data.textShort = ruleSel.conditon.textShort;
                name = 'ruleCond';
            }
            if (ruleSel.timeLimited) {
                livingRuleData.time = ruleSel.timeData;
                livingRuleData.time.timeLocal = node.positionConfig.toTimeString(ruleSel.timeData.value);
                livingRuleData.time.timeLocalDate = node.positionConfig.toDateString(ruleSel.timeData.value);
                livingRuleData.time.dateISO= ruleSel.timeData.value.toISOString();
                livingRuleData.time.dateUTC= ruleSel.timeData.value.toUTCString();
                data.timeOp = ruleSel.timeOpText;
                data.timeLocal = livingRuleData.time.timeLocal;
                data.time = livingRuleData.time.dateISO;
                name = (ruleSel.conditional) ? 'ruleTimeCond' : 'ruleTime';
            }
            node.reason.state= RED._('blind-control.states.'+name, data);
            node.reason.description = RED._('blind-control.reasons.'+name, data);
            // node.debug(`checkRules end pos=${node.level.current} reason=${node.reason.code} description=${node.reason.description} all=${util.inspect(livingRuleData, { colors: true, compact: 10, breakLength: Infinity })}`);
            return livingRuleData;
        }
        livingRuleData.active = false;
        livingRuleData.id = -1;
        node.level.current = node.blindData.levelDefault;
        node.level.currentInverse = getInversePos_(node, node.blindData.levelDefault);
        node.level.topic = node.blindData.topic;
        node.reason.code = 1;
        node.reason.state = RED._('blind-control.states.default');
        node.reason.description = RED._('blind-control.reasons.default');
        // node.debug(`checkRules end pos=${node.level.current} reason=${node.reason.code} description=${node.reason.description} all=${util.inspect(livingRuleData, { colors: true, compact: 10, breakLength: Infinity })}`);
        return livingRuleData;
    }
    /******************************************************************************************/
    /******************************************************************************************/
    /**
     * standard Node-Red Node handler for the sunBlindControlNode
     * @param {*} config the Node-Red Configuration property of the Node
     */
    function sunBlindControlNode(config) {
        RED.nodes.createNode(this, config);
        this.positionConfig = RED.nodes.getNode(config.positionConfig);
        this.outputs = Number(config.outputs || 1);
        this.smoothTime = (parseFloat(config.smoothTime) || -1);

        if (config.autoTrigger) {
            this.autoTrigger = {
                deaultTime : config.autoTrigger.time || 3600000 // 1h
            };
            this.autoTriggerObj = null;
        }
        const node = this;

        if (node.smoothTime >= 0x7FFFFFFF) {
            node.error(RED._('blind-control.errors.smoothTimeToolong', this));
            delete node.smoothTime;
        }
        node.nowarn = {};
        node.reason = {
            code : 0,
            state: '',
            description: ''
        };
        // temporary node Data
        node.levelReverse = false;
        node.storeName = config.storeName || '';
        // Retrieve the config node
        node.sunData = {
            /** Defines if the sun control is active or not */
            active: false,
            mode: Number(hlp.chkValueFilled(config.sunControlMode, 0)),
            topic: config.sunTopic,
            /** define how long could be the sun on the floor **/
            floorLength: Number(hlp.chkValueFilled(config.sunFloorLength,0)),
            /** minimum altitude of the sun */
            minAltitude: Number(hlp.chkValueFilled(config.sunMinAltitude, 0)),
            minDelta: Number(hlp.chkValueFilled(config.sunMinDelta, 0)),
            changeAgain: 0
        };
        node.sunData.modeMax = node.sunData.mode;
        node.windowSettings = {
            /** The top of the window */
            top: Number(config.windowTop),
            /** The bottom of the window */
            bottom: Number(config.windowBottom),
            /** the orientation angle to the geographical north */
            AzimuthStart: angleNorm_(Number(hlp.chkValueFilled(config.windowAzimuthStart, 0))),
            /** an offset for the angle clockwise offset */
            AzimuthEnd: angleNorm_(Number(hlp.chkValueFilled(config.windowAzimuthEnd, 0)))
        };
        node.blindData = {
            /** The Level of the window */
            levelTop: Number(hlp.chkValueFilled(config.blindOpenPos, 100)),
            levelBottom: Number(hlp.chkValueFilled(config.blindClosedPos, 0)),
            increment: Number(hlp.chkValueFilled(config.blindIncrement, 1)),
            levelDefault: NaN,
            levelMin: NaN,
            levelMax: NaN,
            topic: config.topic,
            /** The override settings */
            overwrite: {
                active: false,
                expireDuration: parseFloat(hlp.chkValueFilled(config.overwriteExpire, NaN)),
                importance: 0
            }
        };

        if (node.blindData.levelTop < node.blindData.levelBottom) {
            const tmp = node.blindData.levelBottom;
            node.blindData.levelBottom = node.blindData.levelTop;
            node.blindData.levelTop = tmp;
            node.levelReverse = true;
        }

        node.blindData.levelDefault = getBlindPosFromTI(node, undefined, config.blindPosDefaultType, config.blindPosDefault, node.blindData.levelTop);
        node.blindData.levelMin = getBlindPosFromTI(node, undefined, config.blindPosMinType, config.blindPosMin, node.blindData.levelBottom);
        node.blindData.levelMax = getBlindPosFromTI(node, undefined, config.blindPosMaxType, config.blindPosMax, node.blindData.levelTop);
        node.oversteer = {
            active: (typeof config.oversteerValueType !== 'undefined') && (config.oversteerValueType !== 'none'),
            topic: config.oversteerTopic || config.sunTopic,
            isChecked: false
        };
        node.oversteerData = [];
        if (node.oversteer.active) {
            node.oversteerData.push({
                operand: {
                    value: config.oversteerValue || '',
                    type: config.oversteerValueType || 'none'
                },
                operator: config.oversteerCompare,
                threshold: {
                    value: config.oversteerThreshold || '',
                    type: config.oversteerThresholdType
                },
                blindPos: getBlindPosFromTI(node, undefined, config.oversteerBlindPosType, config.oversteerBlindPos, node.blindData.levelTop)
            });
            if ((typeof config.oversteer2ValueType !== 'undefined') && (config.oversteer2ValueType !== 'none')) {
                node.oversteerData.push({
                    operand: {
                        value: config.oversteer2Value || '',
                        type: config.oversteer2ValueType || 'none'
                    },
                    operator: config.oversteer2Compare,
                    threshold: {
                        value: config.oversteer2Threshold || '',
                        type: config.oversteer2ThresholdType
                    },
                    blindPos: getBlindPosFromTI(node, undefined, config.oversteer2BlindPosType, config.oversteer2BlindPos, node.blindData.levelTop)
                });
            }
            if ((typeof config.oversteer3ValueType !== 'undefined') && (config.oversteer3ValueType !== 'none')) {
                node.oversteerData.push({
                    operand: {
                        value: config.oversteer3Value || '',
                        type: config.oversteer3ValueType || 'none'
                    },
                    operator: config.oversteer3Compare,
                    threshold: {
                        value: config.oversteer3Threshold || '',
                        type: config.oversteer3ThresholdType
                    },
                    blindPos: getBlindPosFromTI(node, undefined, config.oversteer3BlindPosType, config.oversteer3BlindPos, node.blindData.levelTop)
                });
            }
        }

        node.rules = {
            data: config.rules || []
        };
        node.level = {
            current: NaN, // unknown
            currentInverse: NaN
        };
        node.previousData = {
            level: NaN, // unknown
            reasonCode: -1,
            usedRule: NaN
        };


        /**
         * set the state of the node
         */
        this.setState = blindCtrl => {
            let code = node.reason.code;
            let shape = 'ring';
            let fill = 'yellow';
            if (code === 10 && node.previousData) { // smooth;
                code = node.previousData.reasonCode;
            }

            if (blindCtrl.level === node.blindData.levelTop) {
                shape = 'dot';
            }
            if (isNaN(code)) {
                fill = 'red'; // block
                shape = 'dot';
            } else if (code <= 3) {
                fill = 'blue'; // override
            } else if (code === 4 || code === 15 || code === 16) {
                fill = 'grey'; // rule
            } else if (code === 1 || code === 8) {
                fill = 'green'; // not in window or oversteerExceeded
            }

            node.reason.stateComplete = (isNaN(blindCtrl.level)) ? node.reason.state : blindCtrl.level.toString() + ' - ' + node.reason.state;
            node.status({
                fill,
                shape,
                text: node.reason.stateComplete
            });
        };

        /**
         * handles the input of a message object to the node
         */
        this.on('input', function (msg, send, done) {
            // If this is pre-1.0, 'done' will be undefined
            done = done || function (text, msg) {if (text) { return node.error(text, msg); } return null; };
            send = send || function (...args) { node.send.apply(node, args); };

            try {
                node.debug(`--- blind-control - input msg.topic=${msg.topic} msg.payload=${msg.payload}`);
                if (!this.positionConfig) {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: 'Node not properly configured!!'
                    });
                    done(RED._('node-red-contrib-sun-position/position-config:errors.pos-config'), msg);
                    return null;
                }
                node.nowarn = {};
                const tempData = node.context().get('cacheData',node.storeName) || {};
                if (!isNaN(node.level.current)) {
                    node.previousData.level = node.level.current;
                    node.previousData.levelInverse = node.level.currentInverse;
                    node.previousData.topic = node.level.topic;
                    node.previousData.reasonCode = node.reason.code;
                    node.previousData.reasonState = node.reason.state;
                    node.previousData.reasonDescription = node.reason.description;
                }
                node.oversteer.isChecked = false;
                node.reason.code = NaN;
                node.level.topic = '';
                const now = hlp.getNowTimeStamp(node, msg);
                if (node.autoTrigger) {
                    node.autoTrigger.time = node.autoTrigger.deaultTime;
                    node.autoTrigger.type = 0; // default time
                }
                const blindCtrl = {
                    reason : node.reason,
                    blind: node.blindData,
                    autoTrigger : node.autoTrigger
                };
                // check if the message contains any oversteering data
                let ruleId = -1;

                const newMode = hlp.getMsgNumberValue(msg, ['mode'], ['setMode']);
                if (Number.isFinite(newMode) && newMode >= 0 && newMode <= node.sunData.modeMax) {
                    node.debug(`set mode from ${node.sunData.mode} to ${newMode}`);
                    node.sunData.mode = newMode;
                }

                // check for manual overwrite
                if (!checkBlindPosOverwrite(node, msg, now)) {
                    // calc times:
                    blindCtrl.rule = checkRules(node, msg, now, tempData);
                    ruleId = blindCtrl.rule.id;
                    if (!blindCtrl.rule.active && (node.sunData.mode > 0)) {
                        // calc sun position:
                        blindCtrl.sunPosition = calcBlindSunPosition(node, msg, now, tempData);
                    }
                    if (blindCtrl.rule.hasMinimum && (node.level.current < blindCtrl.rule.levelMinimum)) {
                        node.debug(`${node.level.current} is below rule minimum ${blindCtrl.rule.levelMinimum}`);
                        node.reason.code = 15;
                        node.reason.state = RED._('blind-control.states.ruleMin', { org: node.reason.state, number: blindCtrl.rule.minimum.id, name: blindCtrl.rule.minimum.name });
                        node.reason.description = RED._('blind-control.reasons.ruleMin', { org: node.reason.description, level: getRealLevel_(node), number: blindCtrl.rule.minimum.id, name: blindCtrl.rule.minimum.name  });
                        node.level.current = blindCtrl.rule.levelMinimum;
                        node.level.currentInverse = getInversePos_(node, node.level.current);
                    } else if (blindCtrl.rule.hasMaximum && (node.level.current > blindCtrl.rule.levelMaximum)) {
                        node.debug(`${node.level.current} is above rule maximum ${blindCtrl.rule.levelMaximum}`);
                        node.reason.code = 26;
                        node.reason.state = RED._('blind-control.states.ruleMax', { org: node.reason.state, number: blindCtrl.rule.maximum.id, name: blindCtrl.rule.maximum.name });
                        node.reason.description = RED._('blind-control.reasons.ruleMax', { org: node.reason.description, level: getRealLevel_(node), number: blindCtrl.rule.maximum.id, name: blindCtrl.rule.maximum.name });
                        node.level.current = blindCtrl.rule.levelMaximum;
                        node.level.currentInverse = getInversePos_(node, node.level.current);
                    }
                    if (node.level.current < node.blindData.levelBottom) {
                        node.debug(`${node.level.current} is below ${node.blindData.levelBottom}`);
                        node.level.current = node.blindData.levelBottom;
                        node.level.currentInverse = node.blindData.levelTop;
                    }
                    if (node.level.current > node.blindData.levelTop) {
                        node.debug(`${node.level.current} is above ${node.blindData.levelBottom}`);
                        node.level.current = node.blindData.levelTop;
                        node.level.currentInverse = node.blindData.levelBottom;
                    }
                }

                if (node.oversteer.active && !node.oversteer.isChecked) {
                    node.oversteerData.forEach(el => {
                        node.positionConfig.getPropValue(node, msg, {
                            type: el.valueType,
                            value: el.value,
                            callback: (result, _obj) => {
                                if (result !== null && typeof result !== 'undefined') {
                                    tempData[_obj.type + '.' + _obj.value] = result;
                                }
                            },
                            operator: el.operator
                        });
                    });
                }

                if (node.levelReverse) {
                    blindCtrl.level = isNaN(node.level.currentInverse) ? node.previousData.levelInverse : node.level.currentInverse;
                    blindCtrl.levelInverse = isNaN(node.level.current) ? node.previousData.level : node.level.current;
                } else {
                    blindCtrl.level = isNaN(node.level.current) ? node.previousData.level : node.level.current;
                    blindCtrl.levelInverse = isNaN(node.level.currentInverse) ? node.previousData.levelInverse : node.level.currentInverse;
                }

                if (node.startDelayTimeOut) {
                    node.reason.code = NaN;
                    node.reason.state = RED._('blind-control.states.startDelay', {date:node.positionConfig.toTimeString(node.startDelayTimeOut)});
                    node.reason.description = RED._('blind-control.reasons.startDelay', {dateISO:node.startDelayTimeOut.toISOString()});
                }
                node.setState(blindCtrl);

                let topic = node.level.topic || node.blindData.topic || msg.topic;
                if (topic) {
                    const topicAttrs = {
                        name: node.name,
                        level: blindCtrl.level,
                        levelInverse: blindCtrl.levelInverse,
                        code: node.reason.code,
                        state: node.reason.state,
                        rule: ruleId,
                        mode: node.sunData.mode,
                        newtopic: topic,
                        topic: msg.topic,
                        payload: msg.payload
                    };
                    topic = hlp.topicReplace(topic, topicAttrs);
                }

                if ((!isNaN(node.level.current)) &&
                    (!isNaN(node.reason.code)) &&
                    ((node.level.current !== node.previousData.level) ||
                    (node.reason.code !== node.previousData.reasonCode) ||
                    (ruleId !== node.previousData.usedRule))) {
                    msg.payload = blindCtrl.level;
                    msg.topic =  topic;
                    msg.blindCtrl = blindCtrl;
                    if (node.outputs > 1) {
                        send([msg, { topic, payload: blindCtrl }]);
                    } else {
                        send(msg, null);
                    }
                } else if (node.outputs > 1) {
                    send([null, { topic, payload: blindCtrl }]);
                }
                node.previousData.usedRule = ruleId;
                node.context().set('cacheData', tempData, node.storeName);
                if (node.autoTrigger) {
                    node.debug('------------- autotrigger ---------------- ' + node.autoTrigger.time + ' - ' + node.autoTrigger.type);
                    if (node.autoTriggerObj) {
                        clearTimeout(node.autoTriggerObj);
                        node.autoTriggerObj = null;
                    }
                    node.autoTriggerObj = setTimeout(() => {
                        clearTimeout(node.autoTriggerObj);
                        node.emit('input', {
                            topic: 'autoTrigger/triggerOnly',
                            payload: 'triggerOnly',
                            triggerOnly: true
                        });
                    }, node.autoTrigger.time);
                }
                done();
                return null;
            } catch (err) {
                node.log(util.inspect(err, Object.getOwnPropertyNames(err)));
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'internal error: ' + err.message
                });
                done(RED._('node-red-contrib-sun-position/position-config:errors.error', err), msg);
            }
            return null;
        });

        this.on('close', () => {
            if (node.autoTriggerObj) {
                clearTimeout(node.autoTriggerObj);
                node.autoTriggerObj = null;
            }
            // tidy up any state
        });
        // ####################################################################################################
        /**
         * initializes the node
         */
        function initialize() {
            node.debug('initialize ' + node.name + ' [' + node.id + ']');

            const getName = (type, value) => {
                if (type === 'num') {
                    return value;
                } else if (type === 'str') {
                    return '"' + value + '"';
                } else if (type === 'bool') {
                    return '"' + value + '"';
                } else if (type === 'global' || type === 'flow') {
                    value = value.replace(/^#:(.+)::/, '');
                }
                return type + '.' + value;
            };
            const getNameShort = (type, value) => {
                if (type === 'num') {
                    return value;
                } else if (type === 'str') {
                    return '"' + hlp.clipStrLength(value,20) + '"';
                } else if (type === 'bool') {
                    return '"' + value + '"';
                } else if (type === 'global' || type === 'flow') {
                    value = value.replace(/^#:(.+)::/, '');
                    // special for Homematic Devices
                    if (/^.+\[('|").{18,}('|")\].*$/.test(value)) {
                        value = value.replace(/^.+\[('|")/, '').replace(/('|")\].*$/, '');
                        if (value.length > 25) {
                            return '...' + value.slice(-22);
                        }
                        return value;
                    }
                }
                if ((type + value).length > 25) {
                    return type + '...' + value.slice(-22);
                }
                return type + '.' + value;
            };
            node.rules.count = node.rules.data.length;
            node.rules.lastUntil = node.rules.count -1;
            node.rules.checkUntil = false;
            node.rules.checkFrom = false;
            node.rules.firstFrom = node.rules.lastUntil;

            for (let i = 0; i < node.rules.count; ++i) {
                const rule = node.rules.data[i];
                rule.pos = i + 1;
                rule.name = rule.name || 'rule ' + rule.pos;
                rule.timeOp = Number(rule.timeOp) || cRuleUntil;
                rule.levelOp = Number(rule.levelOp) || cRuleAbsolute;
                if (rule.levelOp === 3) { // cRuleMinReset = 3; // ⭳✋ reset minimum
                    rule.levelOp = cRuleMinOversteer;
                    rule.levelType = 'levelND';
                    rule.levelValue = '';
                } else if (rule.levelOp === 4) { // cRuleMaxReset = 4; // ⭱️✋ reset maximum
                    rule.levelOp = cRuleMaxOversteer;
                    rule.levelType = 'levelND';
                    rule.levelValue = '';
                }

                rule.timeLimited = (rule.timeType !== 'none');
                rule.offsetType = rule.offsetType || 'none';
                rule.multiplier = rule.multiplier || 60000;

                rule.timeMinType = rule.timeMinType || 'none';
                rule.timeMinValue = (rule.timeMinValue || '');
                rule.offsetMinType = rule.offsetMinType || 'none';
                rule.multiplierMin = rule.multiplierMin || 60000;

                rule.timeMaxType = rule.timeMaxType || 'none';
                rule.timeMaxValue = (rule.timeMaxValue || '');
                rule.offsetMaxType = rule.offsetMaxType || 'none';
                rule.multiplierMax = rule.multiplierMax || 60000;

                if (!rule.timeDays || rule.timeDays === '*') {
                    rule.timeDays = null;
                } else {
                    rule.timeDays = rule.timeDays.split(',');
                    rule.timeDays = rule.timeDays.map( e => parseInt(e) );
                }

                if (!rule.timeMonths || rule.timeMonths === '*') {
                    rule.timeMonths = null;
                } else {
                    rule.timeMonths = rule.timeMonths.split(',');
                    rule.timeMonths = rule.timeMonths.map( e => parseInt(e) );
                }

                if (!rule.timeLimited) {
                    rule.timeOp = cRuleNoTime;
                }

                if (rule.timeOnlyOddDays && rule.timeOnlyEvenDays) {
                    rule.timeOnlyOddDays = false;
                    rule.timeOnlyEvenDays = false;
                }

                rule.timeDateStart = rule.timeDateStart || '';
                rule.timeDateEnd = rule.timeDateEnd || '';
                if (rule.timeDateStart || rule.timeDateEnd) {
                    if (rule.timeDateStart) {
                        rule.timeDateStart = new Date(rule.timeDateStart);
                        rule.timeDateStart.setHours(0, 0, 0, 1);
                    } else {
                        rule.timeDateStart = new Date(2000,0,1,0, 0, 0, 1);
                    }

                    if (rule.timeDateEnd) {
                        rule.timeDateEnd = new Date(rule.timeDateEnd);
                        rule.timeDateEnd.setHours(23, 59, 59, 999);
                    } else {
                        rule.timeDateEnd = new Date(2000,11,31, 23, 59, 59, 999);
                    }
                }

                rule.conditonData = [];
                const setCondObj = (pretext, defLgOp) => {
                    const operandAType = rule[pretext+'OperandAType'];
                    const conditionValue = Number(rule[pretext+'LogOperator']) || defLgOp;
                    if (operandAType !== 'none' && conditionValue !== cRuleNone) {
                        const operandAValue = rule[pretext+'OperandAValue'];
                        const operandBType = rule[pretext+'OperandBType'];
                        const operandBValue = rule[pretext+'OperandBValue'];
                        rule.conditonData.push(
                            {
                                result: false,
                                operandName: getName(operandAType, operandAValue),
                                thresholdName: getName(operandBType, operandBValue),
                                operand: {
                                    type:operandAType,
                                    value:operandAValue
                                },
                                threshold: {
                                    type:operandBType,
                                    value:operandBValue
                                },
                                operator: {
                                    value : rule[pretext+'Operator'],
                                    text : rule[pretext+'OperatorText'],
                                    description: RED._('node-red-contrib-sun-position/position-config:common.comparatorDescription.' + rule[pretext+'Operator'])
                                },
                                condition:  {
                                    value : conditionValue,
                                    text : rule[pretext+'LogOperatorText']
                                }
                            });
                    }
                    delete rule[pretext+'OperandAType'];
                    delete rule[pretext+'OperandAValue'];
                    delete rule[pretext+'OperandBType'];
                    delete rule[pretext+'OperandBValue'];
                    delete rule[pretext+'Operator'];
                    delete rule[pretext+'OperatorText'];
                    delete rule[pretext+'LogOperator'];
                    delete rule[pretext+'LogOperatorText'];
                };
                setCondObj('valid', cRuleLogOperatorOr);
                setCondObj('valid2', cRuleNone);
                rule.conditional = rule.conditonData.length > 0;

                if (rule.timeOp === cRuleUntil) {
                    node.rules.lastUntil = i;
                    node.rules.checkUntil = true;
                }
                if (rule.timeOp === cRuleFrom && !node.rules.checkFrom) {
                    node.rules.firstFrom = i;
                    node.rules.checkFrom = true;
                }
            }

            if (node.autoTrigger || (parseFloat(config.startDelayTime) > 9)) {
                let delay = parseFloat(config.startDelayTime) || (2000 + Math.floor(Math.random() * 8000)); // 2s - 10s
                delay = Math.min(delay, 2147483646);
                node.startDelayTimeOut = new Date(Date.now() + delay);
                setTimeout(() => {
                    delete node.startDelayTimeOut;
                    node.emit('input', {
                        topic: 'autoTrigger/triggerOnly/start',
                        payload: 'triggerOnly',
                        triggerOnly: true
                    });
                }, delay);
            }
        }

        try {
            initialize();
        } catch (err) {
            node.error(err.message);
            node.log(util.inspect(err, Object.getOwnPropertyNames(err)));
            node.status({
                fill: 'red',
                shape: 'ring',
                text: RED._('node-red-contrib-sun-position/position-config:errors.error-title')
            });
        }
    }

    RED.nodes.registerType('blind-control', sunBlindControlNode);
};