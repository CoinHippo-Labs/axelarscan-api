const {
  promisify,
} = require('util');
const exec = promisify(
  require('child_process').exec
);
const config = require('config-yml');
const {
  log,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const service_name = 'cli';

module.exports.exec = async params => {
  log(
    'info',
    service_name,
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
    cmd?.startsWith('axelard q ') &&
    cmd.endsWith(' -oj') &&
    [
      'bank',
      'evm',
      'multisig',
      'nexus',
      'params',
      'snapshot',
    ].includes(cmd.split(' ')[2])
  ) {
    cmd = `/home/axelard/.axelar${['testnet'].includes(environment) ? `_${environment}` : ''}/bin/${cmd}`;

    log(
      'debug',
      service_name,
      'exec',
      {
        cmd,
      },
    );

    try {
      data = await exec(cmd);

      let {
        stdout,
      } = { ...data };

      stdout =
        stdout
          .trim();

      data = {
        ...data,
        stdout,
      };
    } catch (error) {
      data = error;
    }
  }
  else {
    data = {
      error: 'command not found',
    };
  }

  log(
    'info',
    service_name,
    'send output',
    {
      ...data,
    },
  );

  return data;
};