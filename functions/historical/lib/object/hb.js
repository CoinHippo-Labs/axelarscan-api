// import config
const config = require('config-yml');

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;

module.exports = () => {
  const module = {};
  module.blocksPerHeartbeat = config?.[environment]?.num_blocks_per_heartbeat || 50;
  module.blockFraction = config?.[environment]?.fraction_heartbeat_block || 1;
  module.lastHeartbeatBlock = height => {
    while (height > 0 && height % module.blocksPerHeartbeat !== module.blockFraction) {
      height--;
    }
    return height;
  };
  module.firstHeartbeatBlock = height => module.lastHeartbeatBlock(height);
  return module;
};