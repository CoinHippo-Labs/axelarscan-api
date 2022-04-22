// import utils
const { exec } = require('../services/cli');

// get params
const get_params = req => {
  // initial params
  const params = {
    ...req.query,
    ...req.body,
  };
  return params;
};

module.exports = app => {
  // route's process
  const run = async (req, res) => {
    // exec cli
    const output = await exec(get_params(req));
    // send output
    res.status(200).send(output);
  };

  // set routes
  // /
  app?.get('/', (req, res) => run(req, res));
};