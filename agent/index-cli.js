const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const axelard = async params => {
  const {
    promisify,
  } = require('util');
  const exec = promisify(require('child_process').exec);
  const config = require('config-yml');

  const {
    log,
  } = require('./utils');

  const environment = process.env.ENVIRONMENT || config?.environment;

  log(
    'info',
    'cli',
    'command received',
    {
      ...params,
    },
  );

  let data;

  let {
    cmd,
  } = { ...params };

  if (
    cmd?.startsWith('axelard q ') && cmd.endsWith(' -oj') &&
    ['bank', 'evm', 'multisig', 'nexus', 'params', 'snapshot'].includes(cmd.split(' ')[2])
  ) {
    cmd = `/home/axelard/.axelar${['testnet'].includes(environment) ? `_${environment}` : ''}/bin/${cmd}`;

    try {
      data = await exec(cmd);
      data = {
        ...data,
        stdout: data?.stdout?.trim(),
      };
    } catch (error) {
      data = error;
    }
  }

  log(
    'info',
    'cli',
    'send output',
    {
      ...data,
    },
  );


  return data;
};

app.get('/', async (req, res) => res.status(200).send(await axelard({ ...req.query, ...req.body })));

app.listen(3333);