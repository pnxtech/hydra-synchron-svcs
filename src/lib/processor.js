const hydraExpress = require('hydra-express');
const hydra = hydraExpress.getHydra();
const mdb = require('./mdb');
const moment = require('moment');
const uuid = require('uuid');

const MAX_MESSAGE_CHECK_DELAY = 5000; // five seconds
const ONE_SECOND = 1000;
const THIS_SERVICE = 'hydra-synchron-svcs';

class Processor {
  /**
   * @name init
   * @summary Init stuff
   * @param {object} config - configuration object
   * @return {undefined}
   */
  init(config) {
    this.config = config;
    this.messageCheckDelay = 0;
    this.lastExecutionSweep = ((new Date()).getTime() / 1000) | 0;
    this.checkForTasks();
    this.checkForExecutableTasks();
  }

  /**
   * @name checkForTasks
   * @summary check for message tasks
   * @return {undefined}
   */
  async checkForTasks() {
    let message;
    try {
      message = await hydra.getQueuedMessage(THIS_SERVICE);
    } catch (e) {
      hydraExpress.log('fatal', e);
    }

    if (message && Object.keys(message).length) {
      switch (message.typ) {
        case 'synchron.register':
          await this.handleRegister(message);
          break;
        case 'synchron.deregister':
          await this.handleDeregister(message);
          break;
        case 'synchron.suspend':
          await this.handleSuspend(message);
          break;
        case 'synchron.resume':
          await this.handleResume(message);
          break;
        case 'synchron.status':
          await this.handleStatus(message);
          break;
        default:
          await hydra.markQueueMessage(message, true);
      }
      this.messageCheckDelay = 0;
    } else {
      this.messageCheckDelay += ONE_SECOND;
      if (this.messageCheckDelay > MAX_MESSAGE_CHECK_DELAY) {
        this.messageCheckDelay = MAX_MESSAGE_CHECK_DELAY;
      }
    }
    setTimeout(async () => {
      await this.checkForTasks();
    }, this.messageCheckDelay);
  }

  /**
   * @name checkForExecutableTasks
   * @description check mongodb for tasks which are ready to execute
   */
  async checkForExecutableTasks() {
    try {
      let now = moment();
      let topRange = moment();
      let nowts = ((new Date()).getTime() / 1000) | 0;
      topRange.subtract(nowts - this.lastExecutionSweep, 'seconds');

      const taskColl = mdb.getCollection('tasks');
      let tasks = await taskColl.find({
        targetTime: {
          "$gt": new Date(topRange.toISOString()),
          "$lt": new Date(now.toISOString())
        },
        suspended: false
      }).toArray();

      for await (let task of tasks) {
        let mid = (task.rule.updateMid) ? uuid.v4() : task.message.mid;
        let frm = (task.rule.updateFrm) ? `${hydra.getInstanceID()}@${hydra.getServiceName()}:/` : task.message.frm;
        task.message = Object.assign({}, task.message, {
          mid,
          frm
        });

        if (task.rule.sendType === 'queue') {
          await hydra.queueMessage(task.message);
        } else if (task.rule.sendType === 'send') {
          if (task.rule.broadcast) {
            await hydra.sendBroadcastMessage(task.message);
          } else {
            await hydra.sendMessage(task.message);
          }
        }

        if (task.rule.frequency.oneTime) {
          await taskColl.deleteOne({
            taskID: task.taskID
          });
        } else {
          let offset = moment();
          offset.add(task.rule.frequency.offset[0], task.rule.frequency.offset[1]);
          task.targetTime = new Date(offset.toISOString());
          delete task.rule;
          await taskColl.updateOne({
            taskID: task.taskID
          },{
            $set: task
          },{
            upsert: true
          });
        }
      }
    } catch (e) {
      hydraExpress.log('fatal', e);
    }
    setTimeout(async () => {
      await this.checkForExecutableTasks();
      this.lastExecutionSweep = ((new Date()).getTime() / 1000) | 0;
    }, ONE_SECOND);
  }

  /**
   * @name queueSuccess
   * @description queue a reply message for the sender with success
   * @param {object} message - response message
   * @return {undefined}
   */
  async queueSuccess(message) {
    let reply = hydra.createUMFMessage({
      to: message.frm,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: message.typ,
      bdy: message.bdy
    }).toShort();
    await hydra.queueMessage(reply);
  }

  /**
   * @name queueSuccess
   * @description queue a reply message for the sender with success
   * @param {object} message - response message
   * @return {undefined}
   */
  async queueMessage(message) {
    let reply = hydra.createUMFMessage({
      to: message.to,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: message.typ,
      bdy: message.bdy
    }).toShort();
    await hydra.queueMessage(reply);
  }

  /**
   * @name queueError
   * @description queue a reply message for the sender with an error
   * @param {object} message - original message
   * @param {string} errorText - error string
   * @return {undefined}
   */
  async queueError(message, errorText) {
    let reply = hydra.createUMFMessage({
      to: message.frm,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: message.typ,
      bdy: {
        taskID: message.bdy.taskID,
        error: errorText
      }
    }).toShort();
    await hydra.queueMessage(reply);
  }

  /**
   * @name parseFrequency
   * @description parse a frequency string
   * @param {string} frequency
   * @return {object} object containing oneTime and offset values if value, else empty object
   */
  parseFrequency(frequency) {
    let feq = frequency.toLowerCase();
    let result = {};
    let segs = feq.split(' ');
    if (segs.length === 2) {
      result['oneTime'] = true;
      result['offset'] = segs;
    } else {
      if (segs[0] === 'in') {
        segs.shift();
        result['oneTime'] = true;
        result['offset'] = segs;
      } else if (segs[0] === 'every') {
        segs.shift();
        result['oneTime'] = false;
        result['offset'] = segs;
      }
    }
    return result;
  }

  /**
   * @name handleRegister
   * @description handle incoming register message
   * @param {object} message - incoming message
   * @return {undefined}
   */
  async handleRegister(message) {
    if (!message.bdy.message) {
      this.queueError(message, 'missing bdy.message');
    } else if (message.bdy.rule) {
      let rule = message.bdy.rule;
      let offset = moment();
      let parsedFrequency = this.parseFrequency(rule.frequency);
      if (parsedFrequency['oneTime'] !== undefined) {
        offset.add(parsedFrequency.offset[0], parsedFrequency.offset[1]);
        let updateMid = rule.updateMid || true;
        let updateFrm = rule.updateFrm || true;
        let broadcast = rule.broadcast || false;
        let sendType = rule.sendType;
        if (rule.sendType === 'queue') {
          broadcast = false;
        }
        let doc = {
          taskID: uuid.v4(),
          targetTime: new Date(offset.toISOString()),
          suspended: false,
          rule: {
            frequency: parsedFrequency,
            sendType,
            broadcast,
            updateMid,
            updateFrm
          },
          message: Object.assign({}, message.bdy.message)
        };
        try {
          const taskColl = mdb.getCollection('tasks');
          await taskColl.insertOne(doc);
          let response = Object.assign({}, message);
          response.bdy = {
            taskID: doc.taskID
          };
          await this.queueSuccess(response);
        } catch(e) {
          hydraExpress.log('error', e);
        }
      }
    } else {
      this.queueError(message, 'missing bdy.rule');
    }
    await hydra.markQueueMessage(message, true);
  }

  /**
   * @name handleDeregister
   * @description handle incoming Deregister message
   * @param {object} message - incoming message
   * @return {undefined}
   */
  async handleDeregister(message) {
    await hydra.markQueueMessage(message, true);
  }

  /**
   * @name handleSuspend
   * @description handle incoming Suspend message
   * @param {object} message - incoming message
   * @return {undefined}
   */
  async handleSuspend(message) {
    await hydra.markQueueMessage(message, true);
  }

  /**
   * @name handleResume
   * @description handle incoming Resume message
   * @param {object} message - incoming message
   * @return {undefined}
   */
  async handleResume(message) {
    await hydra.markQueueMessage(message, true);
  }

  /**
   * @name handleStatus
   * @description handle incoming Status message
   * @param {object} message - incoming message
   * @return {undefined}
   */
  async handleStatus(message) {
    await hydra.markQueueMessage(message, true);
  }

};

module.exports = Processor;
