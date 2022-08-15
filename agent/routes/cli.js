const { exec } = require('../services/cli');

const get_params = req => {
  const params = {
    ...req.query,
    ...req.body,
  };
  return params;
};

module.exports = app => {
  const run = async (
    req,
    res,
  ) => {
    // exec cli
    const output = await exec(get_params(req));
    res.status(200)
      .send(output);
  };

  // routes
  app?.get('/', (req, res) => run(req, res));
};