const hydraExpress = require('hydra-express');
const hydra = hydraExpress.getHydra();
const mdb = require('./mdb');

const MAX_MESSAGE_CHECK_DELAY = 5000; // five seconds
const ONE_SECOND = 1000;

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
          await hydra.markQueueMessage(message, true);
          break;

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


};

module.exports = Processor;
