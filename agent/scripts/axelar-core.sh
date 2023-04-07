#!/bin/bash

# help
usage() {
  cat <<EOF

Usage: bash $(basename "${BASH_SOURCE[0]}") [options]
Options:
-h, --help            print options
-e, --environment     environment [testnet|mainnet] [default: testnet]
-f, --flags           options to use on ~/axelarate-community/scripts/node.sh [default: ""]

EOF
  exit
}

# force exit
kill() {
  local message=$1
  local code=${2-1}
  echo ${message}
  exit ${code}
}

# parse options
parse_options() {
  # default
  environment="testnet"
  flags=""

  while :; do
    case "${1-}" in
    -h | --help) usage ;;
    -e | --environment)
      environment="${2-}"
      shift
      ;;
    -f | --flags)
      flags="${2-}"
      shift
      ;;
    -?*) kill "unknown option: $1" ;;
    *) break ;;
    esac
    shift
  done

  args=("$@")
  return 0
}
parse_options "$@"

# run by axelard
cd ~

# set ENV
touch ~/.bash_aliases
echo "export PATH=$PATH:/usr/local/go/bin:~/go/bin:~/.axelar_testnet/bin:~/.axelar/bin" > ~/.bash_aliases
echo "sudo chmod 666 /var/run/docker.sock" >> ~/.bash_aliases
source ~/.bash_aliases

# axelar-core
git clone https://github.com/axelarnetwork/axelarate-community.git
cd ~/axelarate-community
git pull
IP=`curl https://ipinfo.io/ip`
sed -i.bak -e "s/^external_address = \"\"/external_address = \"${IP}:26656\"/" ~/axelarate-community/configuration/config.toml

ulimit -n 65535
sudo chmod 666 /var/run/docker.sock

cd ~/axelarate-community

CORE_VERSION=$(curl -s "https://raw.githubusercontent.com/axelarnetwork/axelar-docs/main/pages/resources/${environment}.mdx" | grep axelar-core | cut -d \` -f 4)
echo ${CORE_VERSION}

KEYRING_PASSWORD=password ./scripts/node.sh -a ${CORE_VERSION} -n ${environment} -e host ${flags}
