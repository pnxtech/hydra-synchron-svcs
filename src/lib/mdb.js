const { Db, MongoClient } = require('mongodb');

/**
 * @name MongoDB
 * @summary MongoDB helper class
 * @returns {undefined}
 */
class MongoDB {
  /**
   * @name open
   * @summary Connect to MongoDB instance
   * @param {string} connectionString uri to mongo db
   * @returns {Promise|Db}
   */
  async open(connectionString) {
    try {
      this.client = await MongoClient.connect(connectionString, {
        useUnifiedTopology: true
      });
    }
    catch (e) {
      console.error('err: ', e);
      throw e;
    }
  }

  /**
   * @name close
   * @summary Close MongoDB client connection
   * @returns {undefined}
   */
  async close() {
    await this.client.close();
  }

  /**
   * @name getDB
   * @summary get a handle to the database client
   * @returns {object} db - handle to db client
   */
  getDB() {
    return this.client.db();
  }

  /**
   * @name getCollection
   * @summary Return collection
   * @param {string} collectionName - name of collection
   * @returns {object} collection
   */
  getCollection(collectionName) {
    return this.client.db().collection(collectionName);
  }
}

module.exports = new MongoDB();
