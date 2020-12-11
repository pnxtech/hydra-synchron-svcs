const main = async () => {
  const hydraExpress = require('hydra-express');
  const hydra = hydraExpress.getHydra();
  const HydraLogger = require('hydra-plugin-hls/hydra-express');
  const hydraLogger = new HydraLogger();
  hydraExpress.use(hydraLogger);

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

    const processor = new Processor(config);
    processor.init(config);
  } catch (err) {
    const stack = err.stack;
    console.error(stack);
  }
};

main();
