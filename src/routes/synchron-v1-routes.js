/**
 * @name queue-scheduler-v1-api
 * @description This module packages the Hydra Queuing Scheduler.
 */
const hydraExpress = require('hydra-express');
const express = hydraExpress.getExpress();
const hydra = hydraExpress.getHydra();
const api = new express.Router();

/**
 * @name [GET]/health
 * @description handles health check requests
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @return {undefined}
 */
api.get('/health', (req, res) => {
  return res.send({
    result: hydra.getHealth()
  });
});

module.exports = api;
