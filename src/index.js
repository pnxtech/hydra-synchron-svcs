const main = async () => {
  const hydraExpress = require('hydra-express');
  const hydra = hydraExpress.getHydra();
  let HydraLogger = require('hydra-plugin-hls/hydra-express');
  let hydraLogger = new HydraLogger();
  hydraExpress.use(hydraLogger);

  const mdb = require('./lib/mdb');
  const config = require('./config/config.json');
  const Processor = require('./lib/processor');

  try {
    const serviceInfo = await hydraExpress.init(config, config.hydra.serviceVersion, () => {
      hydraExpress.registerRoutes({
        '/v1/synchron': require('./routes/synchron-v1-routes')
      });
    });

    console.log(`Started ${hydra.getServiceName()} (v.${hydra.getInstanceVersion()})`);
    console.log(serviceInfo);

    await mdb.open(config.mongodb.connectionString);
    console.log(`Database Connected: ${config.mongodb.connectionString}`);

    let processor = new Processor();
    processor.init(config);
  } catch (err) {
    const stack = err.stack;
    console.error(stack);
  }
};

main();
