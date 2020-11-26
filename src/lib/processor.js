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
    this.checkForTasks();
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
   * @name queueRegistrationSuccess
   * @description queue a reply message for the sender with success
   * @param {object} message - response message
   * @return {undefined}
   */
  async queueRegistrationSuccess(message) {
    let reply = hydra.createUMFMessage({
      to: message.frm,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      typ: 'synchron.register',
      bdy: message.bdy
    }).toShort();
    await hydra.queueMessage(reply);
  }

  /**
   * @name queueRegistrationError
   * @description queue a reply message for the sender with an error
   * @param {object} message - original message
   * @param {string} errorText - error string
   * @return {undefined}
   */
  async queueRegistrationError(message, errorText) {
    let reply = hydra.createUMFMessage({
      to: message.to,
      frm: `${hydra.getInstanceID()}@${hydra.getServiceName()}:/`,
      bdy: {
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
      result['offset'] = segs.join(' ');
    } else {
      if (segs[0] === 'in') {
        segs.shift();
        result['oneTime'] = true;
        result['offset'] = segs.join(' ');
      } else if (segs[0] === 'every') {
        segs.shift();
        result['oneTime'] = false;
        result['offset'] = segs.join(' ');
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
      this.queueRegistrationError(message, 'missing bdy.message');
    } else if (message.bdy.rule) {
      let rule = message.bdy.rule;
      let now = moment();
      let parsedFrequency = this.parseFrequency(rule.frequency);
      if (parsedFrequency['oneTime'] !== undefined) {
        let oneTime = parsedFrequency['oneTime'];
        let offset = now.add(rule.frequency);
        let updateMid = rule.updateMid || true;
        let updateFrm = rule.updateFrm || true;
        let broadcast = rule.broadcast || false;
        let sendType = rule.sendType;
        if (rule.sendType === 'queue') {
          broadcast = false;
        }
        let doc = {
          taskID: uuid.v4(),
          targetTime: offset.toISOString(),
          rule: {
            sendType,
            oneTime,
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
          await this.queueRegistrationSuccess(response);
        } catch(e) {
          hydraExpress.log('error', e);
        }
      }
    } else {
      this.queueRegistrationError(message, 'missing bdy.rule');
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
