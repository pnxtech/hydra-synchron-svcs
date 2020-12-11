const hydraExpress = require('hydra-express');
const hydra = hydraExpress.getHydra();
const moment = require('moment');
const uuid = require('uuid');
const {MongoClient} = require('mongodb');
const MAX_MESSAGE_CHECK_DELAY = 5000; // five seconds
const ONE_SECOND = 1000;
const THIS_SERVICE = 'hydra-synchron-svcs';

/**
 * @name Processor
 */
class Processor {
  /**
   * @name init
   * @summary Init stuff
   * @param {object} config - configuration object
   * @return {undefined}
   */
  async init(config) {
    this.config = config;

    try {
      this.mongoClient = new MongoClient(config.mongodb.connectionString, {
        useUnifiedTopology: true
      });
      await this.mongoClient.connect();
      this.mdb = this.mongoClient.db('synchron');
    } catch (e) {
      hydraExpress.log('fatal', e);
    }

    this.messageCheckDelay = 0;
    this.lastExecutionSweep = ((new Date()).getTime() / 1000) | 0;

    hydra.on('message', (message) => {
      this.dispatchMessage(message, true);
    });

    await this.refreshTasksOnLoad();
    await this.checkForTasks();
    await this.checkForExecutableTasks();
  }

  /**
   * @name refreshTasksOnLoad
   * @description Refresh tasks in DB upon start of this class
   * @return {promise} awaitable
   */
  async refreshTasksOnLoad() {
    try {
      const taskColl = await this.mdb.collection('tasks');
      const cursor = await taskColl.find({
        suspended: false
      }, {
        projection: {
          taskID: 1,
          targetTime: 1,
          rule: 1
        }
      });
      await cursor.forEach(async (task) => {
        const offset = moment();
        offset.add(task.rule.frequency.offset[0], task.rule.frequency.offset[1]);
        task.targetTime = new Date(offset.toISOString());
        delete task.rule;
        await taskColl.updateOne({
          taskID: task.taskID
        }, {
          $set: task
        });
      });
    } catch (e) {
      hydraExpress.log('fatal', e);
    }
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
      await this.dispatchMessage(message, false);
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
   * @name dispatchMessage
   * @description handles the dispatching of send and queue messages
   * @param {object} message - incoming message
   * @param {boolean} sent - was the message sent or queued
   * @return {undefined}
   */
  async dispatchMessage(message, sent) {
    switch (message.typ) {
      case 'synchron.register':
        await this.handleRegister(message, sent);
        break;
      case 'synchron.deregister':
        await this.handleDeregister(message, sent);
        break;
      case 'synchron.suspend':
        await this.handleSuspend(message, sent);
        break;
      case 'synchron.resume':
        await this.handleResume(message, sent);
        break;
      case 'synchron.status':
        await this.handleStatus(message, sent);
        break;
    }
  }

  /**
   * @name checkForExecutableTasks
   * @description check mongodb for tasks which are ready to execute
   * @return {object} promise
   */
  async checkForExecutableTasks() {
    // hydraExpress.log('trace', 'checkForExecutableTasks');
    try {
      const taskColl = await this.mdb.collection('tasks');
      const now = moment();
      const topRange = moment();
      const nowts = ((new Date()).getTime() / 1000) | 0;
      topRange.subtract(nowts - this.lastExecutionSweep, 'seconds');

      const cursor = await taskColl.find({
        targetTime: {
          '$gt': new Date(topRange.toISOString()),
          '$lt': new Date(now.toISOString())
        },
        suspended: false
      });
      await cursor.forEach(async (task) => {
        hydraExpress.log('trace', `Executing task: ${task.taskID} based on rule: ${JSON.stringify(task.rule)}`);
        const mid = (task.rule.updateMid) ? uuid.v4() : task.message.mid;
        const frm = (task.rule.updateFrm) ? `${hydra.getInstanceID()}@${hydra.getServiceName()}:/` : task.message.frm;
        task.message = Object.assign({}, task.message, {
          mid,
          frm
        });
        task.message.bdy = Object.assign({}, task.message.bdy, {
          taskID: task.taskID
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
          hydraExpress.log('trace', `Deregistered onetime task ${task.taskID}`);
        } else {
          const offset = moment();
          offset.add(task.rule.frequency.offset[0], task.rule.frequency.offset[1]);
          task.targetTime = new Date(offset.toISOString());
          task.lastExecution = new Date(now.toISOString());
          delete task.rule;
          await taskColl.updateOne({
            taskID: task.taskID
          }, {
            $set: task
          }, {
            upsert: true
          });
        }
      });
    } catch (e) {
      hydraExpress.log('error', e);
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
    const reply = hydra.createUMFMessage({
      to: message.frm,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: message.typ,
      bdy: message.bdy
    }).toShort();
    await hydra.queueMessage(reply);
  }

  /**
   * @name sendSuccess
   * @description send a reply message for the sender with success
   * @param {object} message - response message
   * @param {object} reply - reply message
   * @return {undefined}
   */
  async sendSuccess(message, reply) {
    await hydra.sendReplyMessage(message, reply);
  }

  /**
   * @name queueSuccess
   * @description queue a reply message for the sender with success
   * @param {object} message - response message
   * @return {undefined}
   */
  async queueMessage(message) {
    const reply = hydra.createUMFMessage({
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
    const reply = hydra.createUMFMessage({
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
   * @name sendError
   * @description send a reply message for the sender with an error
   * @param {object} message - original message
   * @param {string} errorText - error string
   * @return {undefined}
   */
  async sendError(message, errorText) {
    const reply = {
      bdy: {
        taskID: message.bdy.taskID,
        error: errorText
      }
    };
    await hydra.sendReplyMessage(message, reply);
  }

  /**
   * @name parseFrequency
   * @description parse a frequency string
   * @param {string} frequency - frequency object
   * @return {object} object containing oneTime and offset values if value, else empty object
   */
  parseFrequency(frequency) {
    const feq = frequency.toLowerCase();
    const result = {};
    const segs = feq.split(' ');
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
   * @param {boolean} sent - was the message sent or queued
   * @return {undefined}
   */
  async handleRegister(message, sent) {
    if (!message.bdy.message) {
      const note = 'missing bdy.message';
      await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
    } else if (message.bdy.rule) {
      const rule = message.bdy.rule;
      const offset = moment();
      const parsedFrequency = this.parseFrequency(rule.frequency);
      if (parsedFrequency['oneTime'] !== undefined) {
        offset.add(parsedFrequency.offset[0], parsedFrequency.offset[1]);
        const useTaskID = rule.useTaskID || uuid.v4();
        const updateMid = rule.updateMid || true;
        const updateFrm = rule.updateFrm || true;
        let broadcast = rule.broadcast || false;
        const sendType = rule.sendType;
        if (rule.sendType === 'queue') {
          broadcast = false;
        }
        const doc = {
          taskID: useTaskID,
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
          const taskColl = await this.mdb.collection('tasks');
          await taskColl.insertOne(doc);
          const response = Object.assign({}, message);
          response.bdy = {
            taskID: doc.taskID
          };
          await ((sent) ? this.sendSuccess(message, response) : this.queueSuccess(response));
          hydraExpress.log('trace', `Registered task ${doc.taskID} with rule: ${JSON.stringify(doc.rule)}`);
        } catch (e) {
          hydraExpress.log('error', e);
        }
      }
    } else {
      const note = 'missing bdy.rule';
      await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
    }
    (!sent) && await hydra.markQueueMessage(message, true);
  }

  /**
   * @name handleDeregister
   * @description handle incoming Deregister message
   * @param {object} message - incoming message
   * @param {boolean} sent - was the message sent or queued
   * @return {undefined}
   */
  async handleDeregister(message, sent) {
    if (!message.bdy.taskID) {
      const note = 'missing bdy.taskID';
      await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
      return;
    }
    try {
      const taskColl = await this.mdb.collection('tasks');
      const task = await taskColl.findOne({
        taskID: message.bdy.taskID
      }, {
        projection: {
          taskID: 1
        }
      });
      if (!task) {
        const note = 'task not found';
        await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
      } else {
        const result = await taskColl.deleteOne({
          taskID: task.taskID
        });
        if (!result || !result.result.ok) {
          const note = 'task already deregistered';
          await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
        } else {
          const response = Object.assign({}, message);
          await ((sent) ? this.sendSuccess(message, {}) : this.queueSuccess(response));
          hydraExpress.log('trace', `Deregistered task ${task.taskID}`);
        }
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    } catch (e) {
      hydraExpress.log('error', e);
    }
  }

  /**
   * @name handleSuspend
   * @description handle incoming Suspend message
   * @param {object} message - incoming message
   * @param {boolean} sent - was the message sent or queued
   * @return {undefined}
   */
  async handleSuspend(message, sent) {
    if (!message.bdy.taskID) {
      const note = 'missing bdy.taskID';
      await (sent) ? this.sendError(message, note) : this.queueError(message, note);
      return;
    }
    try {
      const taskColl = await this.mdb.collection('tasks');
      const task = await taskColl.findOne({
        taskID: message.bdy.taskID
      }, {
        projection: {
          taskID: 1
        }
      });
      if (!task) {
        const note = 'task not found';
        await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
      } else {
        const result = await taskColl.updateOne({
          taskID: message.bdy.taskID
        }, {
          $set: {
            suspended: true
          }
        });
        if (!result || !result.result.nModified) {
          const note = 'task already suspended';
          await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
        } else {
          const response = Object.assign({}, message);
          await ((sent) ? this.sendSuccess(message, {}) : this.queueSuccess(response));
          hydraExpress.log('trace', `Suspending task ${message.bdy.taskID}`);
        }
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    } catch (e) {
      hydraExpress.log('error', e);
    }
  }

  /**
   * @name handleResume
   * @description handle incoming Resume message
   * @param {object} message - incoming message
   * @param {boolean} sent - was the message sent or queued
   * @return {undefined}
   */
  async handleResume(message, sent) {
    if (!message.bdy.taskID) {
      const note = 'missing bdy.taskID';
      await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
      return;
    }
    try {
      const taskColl = await this.mdb.collection('tasks');
      const task = await taskColl.findOne({
        taskID: message.bdy.taskID
      }, {
        projection: {
          taskID: 1,
          rule: 1
        }
      });
      if (!task) {
        const note = 'task not found';
        await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
      } else {
        const offset = moment();
        offset.add(task.rule.frequency.offset[0], task.rule.frequency.offset[1]);
        const result = await taskColl.updateOne({
          taskID: message.bdy.taskID
        }, {
          $set: {
            suspended: false,
            targetTime: new Date(offset.toISOString())
          }
        });
        if (!result || !result.result.nModified) {
          const note = 'task already resumed';
          await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
        } else {
          const response = Object.assign({}, message);
          await ((sent) ? this.sendSuccess(message, {}) : this.queueSuccess(response));
          hydraExpress.log('trace', `Resuming task ${message.bdy.taskID}, scheduled to execute at ${offset.toISOString()}`);
        }
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    } catch (e) {
      hydraExpress.log('error', e);
    }
  }

  /**
   * @name handleStatus
   * @description handle incoming Status message
   * @param {object} message - incoming message
   * @param {boolean} sent - was the message sent or queued
   * @return {undefined}
   */
  async handleStatus(message, sent) {
    if (!message.bdy.taskID) {
      const note = 'missing bdy.taskID';
      await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
      return;
    }
    try {
      const taskColl = await this.mdb.collection('tasks');
      const task = await taskColl.findOne({
        taskID: message.bdy.taskID
      }, {
        projection: {
          _id: 0,
          rule: 0,
          message: 0
        }
      });
      if (!task) {
        const note = 'task not found';
        await ((sent) ? this.sendError(message, note) : this.queueError(message, note));
      } else {
        const response = Object.assign({}, message);
        response.bdy = task;
        await ((sent) ? this.sendSuccess(message, response) : await this.queueSuccess(response));
        hydraExpress.log('trace', `Status requested for task ${message.bdy.taskID}: ${JSON.stringify(task)}`);
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    } catch (e) {
      hydraExpress.log('error', e);
    }
  }
}

module.exports = Processor;
