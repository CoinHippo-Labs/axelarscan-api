#!/bin/bash

cd ~

# general
sudo apt update
sudo apt upgrade -y
sudo apt install -y gcc g++ make
sudo apt install -y jq

# nodejs
curl -sL https://deb.nodesource.com/setup_16.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install -y nodejs
sudo apt install -y npm
rm ~/nodesource_setup.sh

# docker
curl -fsSL get.docker.com -o get-docker.sh
sudo sh get-docker.sh
rm ~/get-docker.sh
sudo chmod 666 /var/run/docker.sock

# docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
