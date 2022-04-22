// import modules for promise exec
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
// import utils
const { log } = require('../../utils');

// initial service name
const service_name = 'cli';

module.exports.exec = async params => {
  let data;

  log('info', service_name, 'command received', { ...params });
  if (params?.cmd?.startsWith('axelard q ')) {
    const cmd = `$(which docker) exec axelar-core ${params.cmd}`;
    log('debug', service_name, 'exec', { cmd });
    try {
      data = await exec(cmd);
      data.stdout = data.stdout.trim();
    } catch (error) {
      data = error;
    }
  }
  else {
    data = { error: 'command not found' };
  }
  log('info', service_name, 'send output', { ...params });

  return data;
};