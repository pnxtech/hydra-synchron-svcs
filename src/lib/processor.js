const hydraExpress = require('hydra-express');
const hydra = hydraExpress.getHydra();
const moment = require('moment');
const uuid = require('uuid');
const {MongoClient} = require('mongodb');
const MAX_MESSAGE_CHECK_DELAY = 5000; // five seconds
const ONE_SECOND = 1000;
const HALF_SECOND = 500;
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
    this.enableDebugTrace = config.enableDebugTrace || false;
    this.procTimeSpan = HALF_SECOND;
    try {
      this.mongoClient = new MongoClient(config.mongodb.connectionString, {
        useUnifiedTopology: true
      });
      await this.mongoClient.connect();
      this.mdb = this.mongoClient.db('synchron');
    }
    catch (e) {
      hydraExpress.log('fatal', e);
    }

    this.messageCheckDelay = 0;
    hydra.on('message', (message) => {
      this.dispatchMessage(message, true);
    });

    await this.refreshTasksOnLoad();
    this.checkForTasks();
    await this.checkForExecutableTasks();
  }

  /**
   * @name refreshTasksOnLoad
   * @description Refresh tasks in DB upon start of this class
   * @return {promise} awaitable
   */
  async refreshTasksOnLoad() {
    try {
      const taskColl = this.mdb.collection('tasks');
      const cursor = taskColl.find({
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
    }
    catch (e) {
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
    }
    catch (e) {
      hydraExpress.log('fatal', e);
    }
    if (message && Object.keys(message).length) {
      this.dispatchMessage(message, false);
      this.messageCheckDelay = 0;
    } else {
      this.messageCheckDelay += ONE_SECOND;
      if (this.messageCheckDelay > MAX_MESSAGE_CHECK_DELAY) {
        this.messageCheckDelay = MAX_MESSAGE_CHECK_DELAY;
      }
    }
    setTimeout(async () => {
      this.checkForTasks();
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
        this.handleRegister(message, sent);
        break;
      case 'synchron.deregister':
        this.handleDeregister(message, sent);
        break;
      case 'synchron.suspend':
        this.handleSuspend(message, sent);
        break;
      case 'synchron.resume':
        this.handleResume(message, sent);
        break;
      case 'synchron.status':
        this.handleStatus(message, sent);
        break;
      case 'synchron.query':
        this.handleQuery(message, sent);
        break;
      }
  }

  /**
   * @name checkForExecutableTasks
   * @description check mongodb for tasks which are ready to execute
   * @return {object} promise
   */
  async checkForExecutableTasks() {
    // hydraExpress.hydraExpress.log('trace', 'checkForExecutableTasks');
    const now = moment();
    const topRange = moment();
    const backRange = moment();

    topRange.add(HALF_SECOND + this.procTimeSpan, 'ms');
    backRange.subtract(HALF_SECOND + this.procTimeSpan, 'ms');

    const targetTime = {
      '$gt': new Date(backRange.toISOString()),
      '$lt': new Date(topRange.toISOString())
    };
    try {
      const taskColl = this.mdb.collection('tasks');
      const cursor = taskColl.find({
        targetTime,
        suspended: false
      });
      this.enableDebugTrace && hydraExpress.log('trace', ' ');
      this.enableDebugTrace && hydraExpress.log('trace', `Query window: ${JSON.stringify(targetTime)}`);
      await cursor.forEach(async (task) => {
        this.enableDebugTrace && hydraExpress.log('trace', `  Executing task: [${task.taskID}] based on rule: ${new Date(task.targetTime).toISOString()}`);
        // hydraExpress.hydraExpress.log('trace', `Executing task: ${task.taskID} based on rule: ${JSON.stringify(task)}`);
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
          this.enableDebugTrace && hydraExpress.log('trace', `  Updating taskID ${task.taskID} for next execution at ${offset.toISOString()}`);
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
    }
    catch (e) {
      hydraExpress.log('error', e);
    }
    // double processing time to avoid missing items in shifting time window
    this.procTimeSpan = moment().diff(now, 'ms') << 1;
    this.enableDebugTrace && hydraExpress.log('trace', `  procTimeSpan: ${this.procTimeSpan}`);

    setTimeout(async () => {
      await this.checkForExecutableTasks();
    }, ONE_SECOND);
  }

  /**
   * @name queueSuccess
   * @description queue a reply message for the sender with success
   * @param {object} message - response message
   * @return {Promise}
   */
  queueSuccess(message) {
    const reply = hydra.createUMFMessage({
      to: message.frm,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: message.typ,
      bdy: message.bdy
    }).toShort();
    return hydra.queueMessage(reply);
  }

  /**
   * @name sendSuccess
   * @description send a reply message for the sender with success
   * @param {object} message - response message
   * @param {object} reply - reply message
   * @return {Promise}
   */
  sendSuccess(message, reply) {
    return hydra.sendReplyMessage(message, reply);
  }

  /**
   * @name queueSuccess
   * @description queue a reply message for the sender with success
   * @param {object} message - response message
   * @return {Promise}
   */
  queueMessage(message) {
    const reply = hydra.createUMFMessage({
      to: message.to,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: message.typ,
      bdy: message.bdy
    }).toShort();
    return hydra.queueMessage(reply);
  }

  /**
   * @name queueError
   * @description queue a reply message for the sender with an error
   * @param {object} message - original message
   * @param {string} errorText - error string
   * @return {Promise}
   */
  queueError(message, errorText) {
    const reply = hydra.createUMFMessage({
      to: message.frm,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: message.typ,
      bdy: {
        taskID: message.bdy.taskID,
        error: errorText
      }
    }).toShort();
    return hydra.queueMessage(reply);
  }

  /**
   * @name sendError
   * @description send a reply message for the sender with an error
   * @param {object} message - original message
   * @param {string} errorText - error string
   * @return {Promise}
   */
  sendError(message, errorText) {
    const reply = {
      bdy: {
        taskID: message.bdy.taskID,
        error: errorText
      }
    };
    return hydra.sendReplyMessage(message, reply);
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
        const useTaskID = rule.useTaskID || v4();
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
          const taskColl = this.mdb.collection('tasks');
          await taskColl.insertOne(doc);
          const response = Object.assign({}, message);
          response.bdy = {
            taskID: doc.taskID
          };
          await (sent
            ? this.sendSuccess(message, response)
            : this.queueSuccess(response));
          hydraExpress.log('trace', `Registered task ${doc.taskID} with rule: ${JSON.stringify(doc.rule)}`);
        }
        catch (e) {
          hydraExpress.log('error', e);
        }
        finally {

        }
      }
    } else {
      const note = 'missing bdy.rule';
      await ((sent)
        ? this.sendError(message, note)
        : this.queueError(message, note));
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
      await ((sent)
        ? this.sendError(message, note)
        : this.queueError(message, note));
      return;
    }
    try {
      const taskColl = this.mdb.collection('tasks');
      const task = taskColl.findOne({
        taskID: message.bdy.taskID
      }, {
        projection: {
          taskID: 1
        }
      });
      if (!task) {
        const note = 'task not found';
        await ((sent)
          ? this.sendError(message, note) :
          this.queueError(message, note));
      } else {
        const result = await taskColl.deleteOne({
          taskID: task.taskID
        });
        if (!result || !result.result.ok) {
          const note = 'task already deregistered';
          await ((sent)
            ? this.sendError(message, note)
            : this.queueError(message, note));
        } else {
          const response = Object.assign({}, message);
          await ((sent)
            ? this.sendSuccess(message, {}) :
            this.queueSuccess(response));
          hydraExpress.log('trace', `Deregistered task ${task.taskID}`);
        }
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    }
    catch (e) {
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
      await ((sent)
        ? this.sendError(message, note)
        : this.queueError(message, note));
      return;
    }
    try {
      const taskColl = this.mdb.collection('tasks');
      const task = taskColl.findOne({
        taskID: message.bdy.taskID
      }, {
        projection: {
          taskID: 1
        }
      });
      if (!task) {
        const note = 'task not found';
        await ((sent)
          ? this.sendError(message, note) :
          this.queueError(message, note));
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
          await ((sent)
            ? this.sendError(message, note)
            : this.queueError(message, note));
        } else {
          const response = Object.assign({}, message);
          await ((sent)
            ? this.sendSuccess(message, {})
            : this.queueSuccess(response));
          hydraExpress.log('trace', `Suspending task ${message.bdy.taskID}`);
        }
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    }
    catch (e) {
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
      await ((sent)
        ? this.sendError(message, note) :
        this.queueError(message, note));
      return;
    }
    try {
      const taskColl = this.mdb.collection('tasks');
      const task = taskColl.findOne({
        taskID: message.bdy.taskID
      }, {
        projection: {
          taskID: 1,
          rule: 1
        }
      });
      if (!task) {
        const note = 'task not found';
        await ((sent)
          ? this.sendError(message, note)
          : this.queueError(message, note));
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
          await ((sent)
            ? this.sendError(message, note)
            : this.queueError(message, note));
        } else {
          const response = Object.assign({}, message);
          await ((sent)
            ? this.sendSuccess(message, {})
            : this.queueSuccess(response));
          hydraExpress.log('trace', `Resuming task ${message.bdy.taskID}, scheduled to execute at ${offset.toISOString()}`);
        }
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    }
    catch (e) {
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
      await ((sent)
        ? this.sendError(message, note)
        : this.queueError(message, note));
      return;
    }
    try {
      const taskColl = this.mdb.collection('tasks');
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
        await ((sent)
          ? this.sendError(message, note)
          : this.queueError(message, note));
      } else {
        const response = Object.assign({}, message);
        response.bdy = task;
        await ((sent)
          ? this.sendSuccess(message, response)
          : await this.queueSuccess(response));
        hydraExpress.log('trace', `Status requested for task ${message.bdy.taskID}: ${JSON.stringify(task)}`);
      }
      (!sent) && await hydra.markQueueMessage(message, true);
    }
    catch (e) {
      hydraExpress.log('error', e);
    }
  }

  /**
   * @name handleQuery
   * @description handle incoming Query message
   * @param {object} message - incoming message
   * @param {boolean} sent - was the message sent or queued
   * @return {undefined}
   */
  async handleQuery(message, sent) {
    if (!message.bdy.query || !message.bdy.query.method) {
      const note = 'missing bdy.query or bdy.query.method';
      await ((sent)
        ? this.sendError(message, note)
        : this.queueError(message, note));
      return;
    }
    let query = {};
    const method = message.bdy.query.method;
    const details = message.bdy.query.details;
    switch (method) {
      case 'all':
        break;
      case 'active':
        query.suspended = false;
        break;
      case 'suspended':
        query.suspended = true;
        break;
      default: {
        const note = 'invalid query method';
        await ((sent)
          ? this.sendError(message, note)
          : this.queueError(message, note));
        return;
      }
    };
    let detailsProjection = {
      _id: 0
    };
    if (!details || details !== 'full') {
      detailsProjection.rule = 0;
      detailsProjection.message = 0;
    }
    try {
      const taskColl = this.mdb.collection('tasks');
      const cursor = taskColl.find(query, {
        projection: detailsProjection
      });
      let results = [];
      await cursor.forEach(async (task) => {
        results.push(Object.assign({}, task));
      });
      const response = Object.assign({}, message);
      response.bdy = {
        tasks: results
      };
      await ((sent)
        ? this.sendSuccess(response, {}) :
        this.queueSuccess(response));
      (!sent) && await hydra.markQueueMessage(message, true);
    }
    catch (e) {
      hydraExpress.log('error', e);
    }
  }
}

module.exports = Processor;
