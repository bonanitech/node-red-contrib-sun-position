/********************************************
 * clock-timer:
 *********************************************/
const path = require('path');

const hlp = require(path.join(__dirname, '/lib/dateTimeHelper.js'));
const util = require('util');

const cRuleNoTime = -1;
const cRuleUntil = 0;
const cRuleFrom = 1;
// const cRuleAbsolute = 0;
const cRuleNone = 0;
const cRuleLogOperatorAnd = 2;
const cRuleLogOperatorOr = 1;

/******************************************************************************************/
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
                    node.log(RED._('clock-timer.errors.usingTempValue', { type, value, usedValue: tempData[name] }));
                }
                return tempData[name];
            }
            if (node.nowarn[name]) {
                return undefined; // only one error per run
            }
            node.warn(RED._('clock-timer.errors.warning', { message: RED._('clock-timer.errors.notEvaluableProperty', { type, value, usedValue: 'undefined' }) }));
            node.nowarn[name] = true;
            return undefined;
        }
        tempData[name] = data;
        return data;
    }

    /******************************************************************************************/
    /**
     * reset any existing override
     * @param {*} node node data
     */
    function posOverwriteReset(node) {
        node.debug(`posOverwriteReset expire=${node.nodeData.overwrite.expireTs}`);
        node.nodeData.overwrite.active = false;
        node.nodeData.overwrite.importance = 0;
        if (node.timeOutObj) {
            clearTimeout(node.timeOutObj);
            node.timeOutObj = null;
        }
        if (node.nodeData.overwrite.expireTs || node.nodeData.overwrite.expires) {
            delete node.nodeData.overwrite.expires;
            delete node.nodeData.overwrite.expireTs;
            delete node.nodeData.overwrite.expireDate;
            delete node.nodeData.overwrite.expireDateISO;
            delete node.nodeData.overwrite.expireDateUTC;
            delete node.nodeData.overwrite.expireTimeLocal;
            delete node.nodeData.overwrite.expireDateLocal;
        }
    }

    /**
     * setup the expiring of n override or update an existing expiring
     * @param {*} node node data
     * @param {Date} dNow the current timestamp
     * @param {number} dExpire the expiring time, (if it is NaN, default time will be tried to use) if it is not used, nor a Number or less than 1 no expiring activated
     */
    function setExpiringOverwrite(node, dNow, dExpire, reason) {
        node.debug(`setExpiringOverwrite dNow=${dNow}, dExpire=${dExpire}, reason=${reason}`);
        if (node.timeOutObj) {
            clearTimeout(node.timeOutObj);
            node.timeOutObj = null;
        }

        if (isNaN(dExpire)) {
            dExpire = node.nodeData.overwrite.expireDuration;
            node.debug(`using default expire value=${dExpire}`);
        }
        node.nodeData.overwrite.expires = Number.isFinite(dExpire) && (dExpire > 0);

        if (!node.nodeData.overwrite.expires) {
            node.log(`Overwrite is set which never expire (${reason})`);
            node.debug(`expireNever expire=${dExpire}ms ${  typeof dExpire  } - isNaN=${  isNaN(dExpire)  } - finite=${  !isFinite(dExpire)  } - min=${  dExpire < 100}`);
            delete node.nodeData.overwrite.expireTs;
            delete node.nodeData.overwrite.expireDate;
            return;
        }
        node.nodeData.overwrite.expireTs = (dNow.getTime() + dExpire);
        node.nodeData.overwrite.expireDate = new Date(node.nodeData.overwrite.expireTs);
        node.nodeData.overwrite.expireDateISO = node.nodeData.overwrite.expireDate.toISOString();
        node.nodeData.overwrite.expireDateUTC = node.nodeData.overwrite.expireDate.toUTCString();
        node.nodeData.overwrite.expireDateLocal = node.positionConfig.toDateString(node.nodeData.overwrite.expireDate);
        node.nodeData.overwrite.expireTimeLocal = node.positionConfig.toTimeString(node.nodeData.overwrite.expireDate);

        node.log(`Overwrite is set which expires in ${dExpire}ms = ${node.nodeData.overwrite.expireDateISO} (${reason})`);
        node.timeOutObj = setTimeout(() => {
            node.log(`Overwrite is expired (timeout)`);
            posOverwriteReset(node);
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
        if (node.nodeData.overwrite &&
            node.nodeData.overwrite.expires &&
            (node.nodeData.overwrite.expireTs < dNow.getTime())) {
            node.log(`Overwrite is expired (trigger)`);
            posOverwriteReset(node);
        }
        if (isSignificant) {
            hlp.getMsgBoolValue(msg, ['reset','resetOverwrite'], 'resetOverwrite',
                val => {
                    node.debug(`reset val="${util.inspect(val, { colors: true, compact: 10, breakLength: Infinity })  }"`);
                    if (val) {
                        if (node.nodeData.overwrite && node.nodeData.overwrite.active) {
                            node.log(`Overwrite reset by incoming message`);
                        }
                        posOverwriteReset(node);
                    }
                });
        }
    }
    /**
     * setting the reason for override
     * @param {*} node node data
     */
    function setOverwriteReason(node) {
        if (node.nodeData.overwrite.active) {
            if (node.nodeData.overwrite.expireTs) {
                node.reason.code = 3;
                const obj = {
                    importance: node.nodeData.overwrite.importance,
                    timeLocal: node.nodeData.overwrite.expireTimeLocal,
                    dateLocal: node.nodeData.overwrite.expireDateLocal,
                    dateISO: node.nodeData.overwrite.expireDateISO,
                    dateUTC: node.nodeData.overwrite.expireDateUTC
                };
                node.reason.state = RED._('clock-timer.states.overwriteExpire', obj);
                node.reason.description = RED._('clock-timer.reasons.overwriteExpire', obj);
            } else {
                node.reason.code = 2;
                node.reason.state = RED._('clock-timer.states.overwriteNoExpire', { importance: node.nodeData.overwrite.importance });
                node.reason.description = RED._('clock-timer.states.overwriteNoExpire', { importance: node.nodeData.overwrite.importance });
            }
            // node.debug(`overwrite exit true node.nodeData.overwrite.active=${node.nodeData.overwrite.active}`);
            return true;
        }
        // node.debug(`overwrite exit true node.nodeData.overwrite.active=${node.nodeData.overwrite.active}`);
        return false;
    }

    /**
     * check if a manual overwrite should be set
     * @param {*} node node data
     * @param {*} msg message object
     * @returns {boolean} true if override is active, otherwise false
     */
    function checkPosOverwrite(node, msg, dNow) {
        // node.debug(`checkPosOverwrite act=${node.nodeData.overwrite.active} `);
        let isSignificant = false;
        const exactImportance = hlp.getMsgBoolValue(msg, ['exactImportance', 'exactSignificance', 'exactPriority', 'exactPrivilege']);
        const nImportance = hlp.getMsgNumberValue(msg, ['importance', 'significance', 'prio', 'priority', 'privilege'], null, p => {
            if (exactImportance) {
                isSignificant = (node.nodeData.overwrite.importance === p);
            } else {
                isSignificant = (node.nodeData.overwrite.importance <= p);
            }
            checkOverrideReset(node, msg, dNow, isSignificant);
            return p;
        }, () => {
            checkOverrideReset(node, msg, dNow, true);
            return 0;
        });

        if (node.nodeData.overwrite.active && (node.nodeData.overwrite.importance > 0) && !isSignificant) {
        // if (node.nodeData.overwrite.active && (node.nodeData.overwrite.importance > 0) && (node.nodeData.overwrite.importance > importance)) {
            // node.debug(`overwrite exit true node.nodeData.overwrite.active=${node.nodeData.overwrite.active}, importance=${nImportance}, node.nodeData.overwrite.importance=${node.nodeData.overwrite.importance}`);
            // if active, the importance must be 0 or given with same or higher as current overwrite otherwise this will not work
            node.debug(`do not check any overwrite, importance of message ${nImportance} not matches current overwrite importance ${node.nodeData.overwrite.importance}`);
            return setOverwriteReason(node);
        }
        const onlyTrigger = hlp.getMsgBoolValue(msg, ['trigger', 'noOverwrite'], ['triggerOnly', 'noOverwrite']);

        let overrideData = undefined;
        let overrideTopic = undefined;
        if (!onlyTrigger && typeof msg.payload !== 'undefined') {
            if (msg.topic && (msg.topic.includes('manual') ||
                msg.topic.includes('overwrite'))) {
                overrideData = msg.payload;
                overrideTopic = msg.topic;
            } else if (typeof msg.payload === 'object' && (msg.payload.value && (msg.payload.expires || msg.payload.importance || msg.payload.importance))) {
                overrideData = msg.payload.value;
                overrideTopic = msg.topic;
            }
        }

        let nExpire = hlp.getMsgNumberValue(msg, 'expire');
        if (msg.topic && String(msg.topic).includes('noExpir')) {
            nExpire = -1;
        }
        if ((typeof overrideData === 'undefined') && node.nodeData.overwrite.active) {
            node.debug(`overwrite active, check of importance=${nImportance} or nExpire=${nExpire}`);
            if (Number.isFinite(nExpire)) {
                node.debug(`set to new expiring time nExpire="${nExpire}"`);
                // set to new expiring time
                setExpiringOverwrite(node, dNow, nExpire, 'set new expiring time by message');
            }
            if (nImportance > 0) {
                // set to new importance
                node.nodeData.overwrite.importance = nImportance;
            }
            // node.debug(`overwrite exit true node.nodeData.overwrite.active=${node.nodeData.overwrite.active}, expire=${nExpire}`);
            return setOverwriteReason(node);
        } else if (typeof overrideData !== 'undefined') {
            node.debug(`needOverwrite importance=${nImportance} expire=${nExpire}`);
            if (typeof overrideData !== 'undefined') {
                node.debug(`overwrite overrideData=${overrideData}`);
                node.payload.current = overrideData;
                node.payload.topic = overrideTopic;
            }

            if (Number.isFinite(nExpire) || (nImportance <= 0)) {
                // will set expiring if importance is 0 or if expire is explizit defined
                node.debug(`set expiring - expire is explizit defined "${nExpire}"`);
                setExpiringOverwrite(node, dNow, nExpire, 'set expiring time by message');
            } else if ((!exactImportance && (node.nodeData.overwrite.importance < nImportance)) || (!node.nodeData.overwrite.expireTs)) {
                // isSignificant
                // no expiring on importance change or no existing expiring
                node.debug(`no expire defined, using default or will not expire`);
                setExpiringOverwrite(node, dNow, NaN, 'no special expire defined');
            }
            if (nImportance > 0) {
                node.nodeData.overwrite.importance = nImportance;
            }
            node.nodeData.overwrite.active = true;
        }
        // node.debug(`overwrite exit false node.nodeData.overwrite.active=${node.nodeData.overwrite.active}`);
        return setOverwriteReason(node);
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
                    const el = rule.conditonData[i];
                    if (rule.conditon.result === true && el.condition.value === cRuleLogOperatorOr) {
                        break; // not nessesary, becaue already tue
                    } else if (rule.conditon.result === false && el.condition.value === cRuleLogOperatorAnd) {
                        break; // should never bekome true
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
    function getRuleTimeData(node, msg, rule, dNow) {
        rule.timeData = node.positionConfig.getTimeProp(node, msg, {
            type: rule.timeType,
            value : rule.timeValue,
            offsetType : rule.offsetType,
            offset : rule.offsetValue,
            multiplier : rule.multiplier,
            next : false,
            dNow
        });
        if (rule.timeData.error) {
            hlp.handleError(node, RED._('clock-timer.errors.error-time', { message: rule.timeData.error }), undefined, rule.timeData.error);
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
                dNow
            });
            const numMin = rule.timeDataMin.value.getTime();
            rule.timeDataMin.source = 'Min';
            if (rule.timeDataMin.error) {
                hlp.handleError(node, RED._('clock-timer.errors.error-time', { message: rule.timeDataMin.error }), undefined, rule.timeDataAlt.error);
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
                dNow
            });
            const numMax = rule.timeDataMax.value.getTime();
            rule.timeDataMax.source = 'Max';
            if (rule.timeDataMax.error) {
                hlp.handleError(node, RED._('clock-timer.errors.error-time', { message: rule.timeDataMax.error }), undefined, rule.timeDataAlt.error);
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
        // node.debug(`checkRules dNow=${dNow.toISOString()}, nowNr=${nowNr}, dayNr=${dayNr}, dateNr=${dateNr}, monthNr=${monthNr}, dayId=${dayId}, rules.count=${node.rules.count}, rules.lastUntil=${node.rules.lastUntil}`);

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
            // node.debug('fktCheck rule ' + util.inspect(rule, {colors:true, compact:10}));
            if (rule.conditional) {
                try {
                    if (!rule.conditon.result) {
                        return null;
                    }
                } catch (err) {
                    node.warn(RED._('clock-timer.errors.getPropertyData', err));
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
            // node.debug(`pos=${rule.pos} type=${rule.timeOpText} - ${rule.timeValue} - num=${num} - rule.timeData = ${ util.inspect(rule.timeData, { colors: true, compact: 40, breakLength: Infinity }) }`);
            if (dayId === rule.timeData.dayId && num >=0 && (cmp(num) === true)) {
                return rule;
            }
            return null;
        };

        let ruleSel = null;
        let ruleindex = -1;
        // node.debug('first loop count:' + node.rules.count + ' lastuntil:' + node.rules.lastUntil);
        for (let i = 0; i <= node.rules.lastUntil; ++i) {
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
                ruleSel = res;
                ruleindex = i;
                if (rule.timeOp !== cRuleFrom) {
                    break;
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
                    ruleSel = res;
                    break;
                }
            }
        }

        const checkRuleForAT = rule => {
            if (!rule.timeLimited) {
                return;
            }
            const num = getRuleTimeData(node, msg, rule, dNow);
            if (num > nowNr) {
                node.debug('autoTrigger set to rule ' + rule.pos);
                const diff = num - nowNr;
                node.autoTrigger.time = Math.min(node.autoTrigger.time, diff);
                node.autoTrigger.type = 2; // next rule
            }
        };
        if (ruleSel) {
            if (node.autoTrigger) {
                if (ruleSel.timeLimited && ruleSel.timeData.ts > nowNr) {
                    node.debug('autoTrigger set to rule ' + ruleSel.pos + ' (current)');
                    const diff = ruleSel.timeData.ts - nowNr;
                    node.autoTrigger.time = Math.min(node.autoTrigger.time, diff);
                    node.autoTrigger.type = 1; // current rule end
                } else {
                    for (let i = (ruleindex+1); i < node.rules.count; ++i) {
                        const rule = node.rules.data[i];
                        if (!rule.timeLimited) {
                            continue;
                        }
                        checkRuleForAT(rule);
                    }
                    // check first rule, maybe next day
                    if ((node.autoTrigger.type !== 2) && (node.rules.firstTimeLimited < node.rules.count)) {
                        checkRuleForAT(node.rules.data[node.rules.firstTimeLimited]);
                    }
                }
            }
            // ruleSel.text = '';
            // node.debug('ruleSel ' + util.inspect(ruleSel, {colors:true, compact:10, breakLength: Infinity }));
            livingRuleData.id = ruleSel.pos;
            livingRuleData.name = ruleSel.name;
            livingRuleData.importance = ruleSel.importance;
            livingRuleData.resetOverwrite = ruleSel.resetOverwrite;
            livingRuleData.code = 4;
            livingRuleData.topic = ruleSel.topic;

            livingRuleData.active = true;
            livingRuleData.outputValue = ruleSel.outputValue;
            livingRuleData.outputType = ruleSel.outputType;

            livingRuleData.conditional = ruleSel.conditional;
            livingRuleData.timeLimited = ruleSel.timeLimited;
            livingRuleData.payloadData = {
                type: ruleSel.payloadType,
                value: ruleSel.payloadValue,
                format: ruleSel.payloadFormat,
                offsetType: ruleSel.payloadOffsetType,
                offset: ruleSel.payloadOffsetValue,
                multiplier: ruleSel.payloadOffsetMultiplier,
                next: true
            };
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
            livingRuleData.state= RED._('clock-timer.states.'+name, data);
            livingRuleData.description = RED._('clock-timer.reasons.'+name, data);
            // node.debug(`checkRules data=${util.inspect(data, { colors: true, compact: 10, breakLength: Infinity })}`);
            // node.debug(`checkRules end livingRuleData=${util.inspect(livingRuleData, { colors: true, compact: 10, breakLength: Infinity })}`);
            return livingRuleData;
        }
        livingRuleData.active = false;
        livingRuleData.id = -1;
        livingRuleData.importance = 0;
        livingRuleData.resetOverwrite = false;
        livingRuleData.payloadData = {
            type: node.nodeData.payloadDefaultType,
            value: node.nodeData.payloadDefault,
            format: node.nodeData.payloadDefaultTimeFormat,
            offsetType: node.nodeData.payloadDefaultOffsetType,
            offset: node.nodeData.payloadDefaultOffset,
            multiplier: node.nodeData.payloadDefaultOffsetMultiplier,
            next: true
        };
        livingRuleData.topic = node.nodeData.topic;
        livingRuleData.code = 1;
        livingRuleData.state = RED._('clock-timer.states.default');
        livingRuleData.description = RED._('clock-timer.reasons.default');

        if (node.autoTrigger && node.rules && node.rules.count > 0) {
            // check first rule, maybe next day
            if (node.rules.firstTimeLimited < node.rules.count) {
                checkRuleForAT(node.rules.data[node.rules.firstTimeLimited]);
            }
            if (node.rules.firstTimeLimited !== node.rules.firstFrom) {
                checkRuleForAT(node.rules.data[node.rules.firstFrom]);
            }
        }
        // node.debug(`checkRules end livingRuleData=${util.inspect(livingRuleData, { colors: true, compact: 10, breakLength: Infinity })}`);
        return livingRuleData;
    }
    /******************************************************************************************/
    /******************************************************************************************/
    /**
     * standard Node-Red Node handler for the clockTimerNode
     * @param {*} config the Node-Red Configuration property of the Node
     */
    function clockTimerNode(config) {
        RED.nodes.createNode(this, config);
        this.positionConfig = RED.nodes.getNode(config.positionConfig);
        this.outputs = Number(config.outputs || 1);

        if (config.autoTrigger) {
            this.autoTrigger = {
                defaultTime : config.autoTriggerTime || 20 * 60000 // 20min
            };
            this.autoTriggerObj = null;
        }
        const node = this;

        node.nowarn = {};
        node.reason = {
            code : 0,
            state: '',
            description: ''
        };
        // temporary node Data
        node.storeName = config.storeName || '';
        node.nodeData = {
            /** The Level of the window */
            payloadDefault: config.payloadDefault,
            payloadDefaultType: config.payloadDefaultType,
            payloadDefaultTimeFormat: config.payloadDefaultTimeFormat,
            payloadDefaultOffset: config.payloadDefaultOffset,
            payloadDefaultOffsetType: config.payloadDefaultOffsetType,
            payloadDefaultOffsetMultiplier: config.payloadDefaultOffsetMultiplier,
            topic:config.topic,
            /** The override settings */
            overwrite: {
                active: false,
                expireDuration: parseFloat(hlp.chkValueFilled(config.overwriteExpire, NaN)),
                importance: 0
            }
        };

        node.rules = {
            data: config.rules || []
        };
        node.payload = {
            current: undefined,
            topic: node.nodeData.topic
        };
        node.previousData = {
            reasonCode: -1,
            usedRule: NaN
        };

        /**
         * set the state of the node
         */
        this.setState = pLoad => {
            const code = node.reason.code;
            let shape = 'ring';
            let fill = 'yellow';

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

            node.reason.stateComplete = node.reason.state ;
            if (pLoad === null || typeof pLoad !== 'object') {
                node.reason.stateComplete = hlp.clipStrLength(''+pLoad,20) + ' - ' + node.reason.stateComplete;
            } else if (typeof pLoad === 'object') {
                node.reason.stateComplete = hlp.clipStrLength(JSON.stringify(pLoad),20) + ' - ' + node.reason.stateComplete;
            }
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
                node.debug(`--------- clock-timer - input msg.topic=${msg.topic} msg.payload=${msg.payload} msg.ts=${msg.ts}`);
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
                node.previousData.payloadType = (typeof node.payload.current);
                node.previousData.reasonCode = node.reason.code;
                node.previousData.reasonState = node.reason.state;
                node.previousData.reasonDescription = node.reason.description;
                if (node.previousData.payloadType === 'string' ||
                    node.previousData.payloadType === 'boolean' ||
                    node.previousData.payloadType === 'number') {
                    node.previousData.payloadValue = node.payload.current;
                    node.previousData.payloadSimple = true;
                }
                node.reason.code = NaN;
                const dNow = hlp.getNowTimeStamp(node, msg);
                if (node.autoTrigger) {
                    node.autoTrigger.time = node.autoTrigger.defaultTime;
                    node.autoTrigger.type = 0; // default time
                }

                // check if the message contains any oversteering data
                let ruleId = -2;
                const timeCtrl = {
                    autoTrigger : node.autoTrigger
                };


                // check for manual overwrite
                let overwrite = checkPosOverwrite(node, msg, dNow);
                if (!overwrite || node.rules.canResetOverwrite || (node.rules.maxImportance > 0 && node.rules.maxImportance > node.nodeData.overwrite.importance)) {
                    // calc times:
                    timeCtrl.rule = checkRules(node, msg, dNow, tempData);
                    node.debug(`overwrite=${overwrite}, node.rules.maxImportance=${node.rules.maxImportance}, nodeData.overwrite.importance=${node.nodeData.overwrite.importance}`);
                    if (overwrite && timeCtrl.rule.resetOverwrite && timeCtrl.rule.id !== node.previousData.usedRule) {
                        posOverwriteReset(node);
                        overwrite = false;
                    }

                    if (!overwrite || timeCtrl.rule.importance > node.nodeData.overwrite.importance) {
                        ruleId = timeCtrl.rule.id;
                        node.payload.current = node.positionConfig.getOutDataProp(node, msg, timeCtrl.rule.payloadData, dNow);
                        node.payload.topic = timeCtrl.rule.topic;
                        node.reason.code = timeCtrl.rule.code;
                        node.reason.state = timeCtrl.rule.state;
                        node.reason.description = timeCtrl.rule.description;
                    }
                }

                // node.debug(`result manual=${node.nodeData.overwrite.active} reasoncode=${node.reason.code} description=${node.reason.description}`);
                timeCtrl.reason = node.reason;
                timeCtrl.timeClock = node.nodeData;

                if (node.startDelayTimeOut) {
                    node.reason.code = NaN;
                    node.reason.state = RED._('clock-timer.states.startDelay', {date:node.positionConfig.toTimeString(node.startDelayTimeOut)});
                    node.reason.description = RED._('clock-timer.reasons.startDelay', {dateISO:node.startDelayTimeOut.toISOString()});
                }
                node.setState(node.payload.current);
                let topic = node.payload.topic;
                if (topic) {
                    const topicAttrs = {
                        name: node.name,
                        code: node.reason.code,
                        state: node.reason.state,
                        rule: ruleId,
                        newtopic: node.payload.topic,
                        topic: msg.topic,
                        payload: msg.payload
                    };
                    topic = hlp.topicReplace(topic, topicAttrs);
                }

                if ((typeof node.payload.current !== 'undefined') &&
                    (node.payload.current !== 'none') &&
                    (node.payload.current !== null) &&
                    !isNaN(node.reason.code) &&
                    ((node.reason.code !== node.previousData.reasonCode) ||
                    (ruleId !== node.previousData.usedRule) ||
                    (typeof node.payload.current !== node.previousData.payloadType) ||
                    ((typeof node.previousData.payloadValue  !== 'undefined') && (node.previousData.payloadValue !== node.payload.current))) ) {
                    msg.payload = node.payload.current;
                    msg.topic =  topic;
                    msg.timeCtrl = timeCtrl;
                    if (node.outputs > 1) {
                        send([msg, { topic, payload: timeCtrl, payloadOut: node.payload.current }]);
                    } else {
                        send(msg, null);
                    }
                } else if (node.outputs > 1) {
                    send([null, { topic, payload: timeCtrl }]);
                }
                node.previousData.usedRule = ruleId;
                node.context().set('cacheData', tempData, node.storeName);
                if (node.autoTrigger) {
                    node.debug('------------- autoTrigger ---------------- ' + node.autoTrigger.time + ' - ' + node.autoTrigger.type);
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

            // Prepare Rules
            node.rules.count = node.rules.data.length;
            node.rules.lastUntil = node.rules.count -1;
            node.rules.firstFrom = node.rules.lastUntil;
            node.rules.firstTimeLimited = node.rules.count;
            node.rules.maxImportance = 0;
            node.rules.canResetOverwrite = false;

            for (let i = 0; i < node.rules.count; ++i) {
                const rule = node.rules.data[i];
                rule.pos = i + 1;
                rule.name = rule.name || 'rule ' + rule.pos;
                rule.resetOverwrite = (rule.resetOverwrite === true || rule.resetOverwrite === 'true') ? true : false;
                rule.importance = Number(rule.importance) || 0;
                node.rules.maxImportance = Math.max(node.rules.maxImportance, rule.importance);
                node.rules.canResetOverwrite = node.rules.canResetOverwrite || rule.resetOverwrite;
                rule.timeOp = Number(rule.timeOp) || cRuleUntil;

                rule.timeLimited = (rule.timeType && (rule.timeType !== 'none'));

                if (!rule.timeLimited) {
                    rule.timeOp = cRuleNoTime;
                    delete rule.offsetType;
                    delete rule.multiplier;

                    delete rule.timeMinType;
                    delete rule.timeMinValue;
                    delete rule.offsetMinType;
                    delete rule.multiplierMin;

                    delete rule.timeMaxType;
                    delete rule.timeMaxValue;
                    delete rule.offsetMaxType;
                    delete rule.multiplierMax;

                    delete rule.timeDays;
                    delete rule.timeMonths;
                    delete rule.timeOnlyOddDays;
                    delete rule.timeOnlyEvenDays;
                    delete rule.timeDateStart;
                    delete rule.timeDateEnd;
                } else {
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

                    node.rules.firstTimeLimited = Math.min(i,node.rules.firstTimeLimited);
                    if (rule.timeOp === cRuleUntil) {
                        node.rules.lastUntil = i;
                    }
                    if (rule.timeOp === cRuleFrom) {
                        node.rules.firstFrom = Math.min(i,node.rules.firstFrom);
                    }

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
                }

                rule.conditonData = [];
                const setCondObj = (pretext, defLgOp) => {
                    const operandAType = rule[pretext+'OperandAType'];
                    const conditionValue = Number(rule[pretext+'LogOperator']) || defLgOp;
                    if (operandAType !== 'none' && conditionValue !== cRuleNone) {
                        const operandAValue = rule[pretext+'OperandAValue'];
                        const operandBType = rule[pretext+'OperandBType'];
                        const operandBValue = rule[pretext+'OperandBValue'];
                        const el =  {
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
                        };
                        if (el.operandName.length > 25) {
                            el.operandNameShort = getNameShort(operandAType, operandAValue);
                        }
                        if (el.thresholdName.length > 25) {
                            el.thresholdNameShort = getNameShort(operandBType, operandBValue);
                        }
                        el.text = el.operandName + ' ' + el.operator.text;
                        el.textShort = (el.operandNameShort || el.operandName) + ' ' + el.operator.text;
                        rule.conditonData.push(el);
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

    RED.nodes.registerType('clock-timer', clockTimerNode);
};