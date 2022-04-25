#!/bin/bash

# help
usage() {
  cat <<EOF

Usage: bash $(basename "${BASH_SOURCE[0]}") [options]
Options:
-h, --help            print options
-e, --environment     environment [testnet|mainnet|devnet] [default: testnet]
-r, --aws-region      aws region [default: us-east-1]
-p, --aws-profile     aws profile [default: default]

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
  aws_region="us-east-1"
  aws_profile="default"

  while :; do
    case "${1-}" in
    -h | --help) usage ;;
    -e | --environment)
      environment="${2-}"
      shift
      ;;
    -r | --aws-region)
      aws_region="${2-}"
      shift
      ;;
    -p | --aws-profile)
      aws_profile="${2-}"
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

log() {
  local level=$1
  local from=$2
  local message=$3
  local data=$4

  # setup color for output message
  LIGHT_BLUE="\033[0;94m"
  LIGHT_YELLOW="\033[0;93m"
  GRAY="\033[0;90m"
  CYAN="\033[0;36m"
  YELLOW="\033[0;33m"
  GREEN="\033[0;32m"
  RED="\033[0;31m"
  NO_COLOR="\033[0m"

  if [ "${level}" == "error" ]; then
    level="${RED}ERR"
  elif [ "${level}" == "warn" ]; then
    level="${YELLOW}WARN"
  elif [ "${level}" == "debug" ]; then
    level="${GREEN}DBG"
  else
    level="${GREEN}INF"
  fi

  log_message="${GRAY}$(date)${NO_COLOR} ${level}${NO_COLOR} ${LIGHT_BLUE}[$(echo ${from} | tr a-z A-Z)]${NO_COLOR} ${LIGHT_YELLOW}${message}:${NO_COLOR} ${CYAN}${data}${NO_COLOR}"
  echo -e ${log_message}
}

# set script directory
script_dir=$(dirname "$(readlink -f $0)")
# set function directory
function_dir=${script_dir}/../functions
# check function directory exist
if [ ! -d "${function_dir}" ]; then kill "${function_dir} does not exists"; fi
# .env file
env_file_name=".env.${environment}"
# function prefix
function_prefix="axelarscan"
# function
function="api"
# set function name
function_name="${function_prefix}-${function}-${environment}"
# set compress file name
zip_name="${function_prefix}-${function}.zip"

# create .env (if not exist) from .env template
if [ ! -e "${script_dir}/${env_file_name}" ]; then
  cp ${script_dir}/.env.template ${script_dir}/${env_file_name}
fi

# function read .env
get_variable_value() {
  local variable_key=$1
  echo $(cat ${script_dir}/${env_file_name} | grep ${variable_key} | cut -f 2 -d "=" | sed -e 's/^"//' -e 's/"$//')
}

# set indexer username & password if not set yet
# indexer username
indexer_username=$(get_variable_value "INDEXER_USERNAME")
while [ -z "${indexer_username}" ]; do
  # username
  echo -n "Setup your Indexer username: "
  read -r indexer_username
  echo ""
done
# update INDEXER_USERNAME in .env file
sed -i '' -e 's,^INDEXER_USERNAME*=.*,INDEXER_USERNAME="'"${indexer_username}"'",' ${script_dir}/${env_file_name}
# indexer password
indexer_password=$(get_variable_value "INDEXER_PASSWORD")
if [ -z "${indexer_password}" ]; then
  no_password=1
else
  no_password=0
fi
while [ "${no_password}" -eq 1 ]; do
  # password
  while [ -z "${indexer_password}" ]; do
    echo -n "Setup your Indexer password: "
    read -s indexer_password
    echo ""
  done
  # confirm password
  while [ -z "${confirm_indexer_password}" ]; do
    echo -n "Confirm your Indexer password: "
    read -s confirm_indexer_password
    echo ""
  done
  # compare password
  if [ "${indexer_password}" == "${confirm_indexer_password}" ]; then
    no_password=0
  else
    indexer_password=""
    confirm_indexer_password=""
    echo "Password not match"
  fi
done
# update INDEXER_PASSWORD in .env file
sed -i '' -e 's,^INDEXER_PASSWORD*=.*,INDEXER_PASSWORD="'"${indexer_password}"'",' ${script_dir}/${env_file_name}

# setup indexer
# set indexer name
indexer_name=${function_prefix}-${environment}
log "debug" "${function}" "query current indexer" "${indexer_name}"
# get existing indexer
indexer_name_exist=$(aws opensearch describe-domain \
  --domain-name "${indexer_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".DomainStatus.DomainName" | sed -e 's/^"//' -e 's/"$//')
# check indexer not exist
if [ "${indexer_name}" != "${indexer_name_exist}" ]; then
  log "info" "${function}" "create indexer" "${indexer_name}"
  # set policy
  policy="{ \"Version\": \"2012-10-17\", \"Statement\": [{ \"Effect\": \"Allow\", \"Principal\": { \"AWS\": [\"*\"] }, \"Action\": [\"es:*\"], \"Resource\": \"arn:aws:es:${aws_region}:499786161782:domain/${indexer_name}/*\" }] }"
  # create indexer
  indexer_url=$(aws opensearch create-domain \
    --domain-name "${indexer_name}" \
    --engine-version "OpenSearch_1.1" \
    --cluster-config "InstanceType=r5.xlarge.search,InstanceCount=3,DedicatedMasterEnabled=false,ZoneAwarenessEnabled=false,WarmEnabled=false" \
    --ebs-options "EBSEnabled=true,VolumeType=gp2,VolumeSize=128" \
    --access-policies "${policy}" \
    --encryption-at-rest-options "Enabled=true" \
    --node-to-node-encryption-options "Enabled=true" \
    --domain-endpoint-options "EnforceHTTPS=true" \
    --advanced-security-options "Enabled=true,InternalUserDatabaseEnabled=true,MasterUserOptions={MasterUserName=${indexer_username},MasterUserPassword=${indexer_password}}" \
    --region "${aws_region}" \
    --profile "${aws_profile}" \
    | jq ".DomainStatus.Endpoint" | sed -e 's/^"//' -e 's/"$//')
  # show how to track creation status via console
  echo -e "${GREEN}
######################################################################
# Check status on AWS console:
# ${CYAN}https://${aws_region}.console.aws.amazon.com/esv3/home?#opensearch/domains/${indexer_name}${GREEN}
######################################################################${NO_COLOR}"
  echo "creating ..."
  # wait for creation
  while [ -z "${indexer_url}" ] || [ "${indexer_url}" == "null" ]; do
    # get indexer url
    indexer_url=$(aws opensearch describe-domain \
    --domain-name "${indexer_name}" \
    --region "${aws_region}" \
    --profile "${aws_profile}" \
    | jq ".DomainStatus.Endpoint" | sed -e 's/^"//' -e 's/"$//')
    sleep 5
  done
fi
# get indexer url
indexer_url=$(aws opensearch describe-domain \
  --domain-name "${indexer_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".DomainStatus.Endpoint" | sed -e 's/^"//' -e 's/"$//')
# show indexer url to user
echo -e "${GREEN}
######################################################################
# Your Indexer Endpoint:
# ${CYAN}${indexer_url}${GREEN}
######################################################################
${NO_COLOR}"

# go to function directory
cd ${function_dir}/${function}
log "debug" "${function}" "packing" "${zip_name}"
# remove file before pack
rm -f ${function_dir}/${function}/${zip_name}*
# update dependencies & pack function
npm install && rm package-lock.json && zip -r ${zip_name} *

# set timeout, memory size and environment
timeout=30
memory_size=256
indexer_username=$(get_variable_value "INDEXER_USERNAME")
indexer_password=$(get_variable_value "INDEXER_PASSWORD")
environment_variables="Variables={NODE_NO_WARNINGS=1,ENVIRONMENT=${environment},INDEXER_USERNAME=${indexer_username},INDEXER_PASSWORD=${indexer_password}}"

log "debug" "${function}" "query current function" "${function_name}"
# get existing function
function_name_exist=$(aws lambda get-function \
  --function-name "${function_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Configuration.FunctionName" | sed -e 's/^"//' -e 's/"$//')
# check function exist
if [ "${function_name}" == "${function_name_exist}" ]; then
  log "info" "${function}" "update function" "${function_name}"
  # update function to aws lambda
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --zip-file fileb://${function_dir}/${function}/${zip_name} \
    --region "${aws_region}" \
    --profile "${aws_profile}"
    # --s3-bucket "${aws_bucket}" \
    # --s3-key "${zip_name}" \
  log "info" "${function}" "update function configuration" "${function_name}"
  # update function configuration to aws lambda
  aws lambda update-function-configuration \
    --function-name "${function_name}" \
    --runtime "nodejs14.x" \
    --handler "index.handler" \
    --timeout ${timeout} \
    --memory-size ${memory_size} \
    --environment "${environment_variables}" \
    --region "${aws_region}" \
    --profile "${aws_profile}"
else
  # create execution role for function
  # set role name
  role_name=${function_name}-role-lambda
  log "info" "${function}" "create role for function" "${role_name}"
  # set policy
  policy="{ \"Version\": \"2012-10-17\", \"Statement\": [{ \"Effect\": \"Allow\", \"Principal\": { \"Service\": \"lambda.amazonaws.com\" }, \"Action\": \"sts:AssumeRole\" }] }"
  # create execution role
  role_arn=$(aws iam create-role \
    --role-name "${role_name}" \
    --assume-role-policy-document "${policy}" \
    --profile "${aws_profile}" \
    | jq ".Role.Arn" | sed -e 's/^"//' -e 's/"$//')
  # attach role policy
  aws iam attach-role-policy \
    --role-name "${role_name}" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" \
    --profile "${aws_profile}"
  # wait for role creation
  sleep 5
  log "info" "${function}" "create function" "${function_name}"
  # create function to aws lambda
  aws lambda create-function \
    --function-name "${function_name}" \
    --runtime "nodejs14.x" \
    --handler "index.handler" \
    --role "${role_arn}" \
    --timeout ${timeout} \
    --memory-size ${memory_size} \
    --environment "${environment_variables}" \
    --zip-file fileb://${function_dir}/${function}/${zip_name} \
    --region "${aws_region}" \
    --profile "${aws_profile}"
    # --code "S3Bucket=${aws_bucket},S3Key=${zip_name}" \
fi
# remove file after upload
rm -f ${function_dir}/${function}/${zip_name}*

log "debug" "${function}" "query function arn" "${function_name}"
# get function arn
target_arn=$(aws lambda get-function \
  --function-name "${function_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Configuration.FunctionArn" | sed -e 's/^"//' -e 's/"$//')
# start setup trigger
# set api name
api_name=${function_name}-api

log "info" "${function}" "query current api" "${api_name}"
# get existing api
api_name_exist=$(aws apigatewayv2 get-apis \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Items[] | select(.Name==\"${api_name}\") | .Name" | sed -e 's/^"//' -e 's/"$//')
# get only one api exist
api_name_exist=$(echo ${api_name_exist} | cut -f 1 -d " ")
# check api not exist
if [ "${api_name}" != "${api_name_exist}" ]; then
  log "info" "${function}" "create api" "${api_name}"
  # create api
  api_id=$(aws apigatewayv2 create-api \
    --name "${api_name}" \
    --protocol-type "HTTP" \
    --route-key "ANY /${function_name}" \
    --target "${target_arn}" \
    --region "${aws_region}" \
    --profile "${aws_profile}" \
    | jq ".ApiId" | sed -e 's/^"//' -e 's/"$//')

  # list of routes
  routes=( "/" "/crosschain/{function}" )
  # loop routes
  for route in "${routes[@]}"; do
    # set route key
    route_key="ANY ${route}"

    log "info" "${function}" "create api route" "${route_key}"
    # create route
    aws apigatewayv2 create-route \
      --api-id "${api_id}" \
      --route-key "${route_key}" \
      --region "${aws_region}" \
      --profile "${aws_profile}"
  done

  # get api url
  api_url=$(aws apigatewayv2 get-api \
    --api-id "${api_id}" \
    --region "${aws_region}" \
    --profile "${aws_profile}" \
    | jq ".ApiEndpoint" | sed -e 's/^"//' -e 's/"$//')

  # show next step to user about how to add trigger to function via console
  # show api url to user
  echo -e "${GREEN}
######################################################################
# Next, open AWS console:
# ${CYAN}https://${aws_region}.console.aws.amazon.com/apigateway/main/develop/integrations/attach?api=${api_id}${GREEN}
#
# And select route \"/\" ANY
# - Choose an existing integration
# - Then click \"Attach integration\" button
# - repeat above instructions for routes:
#   - \"/crosschain/{function}\"
#
# Your API Endpoint:
# ${CYAN}${api_url}${GREEN}
######################################################################
${NO_COLOR}"
fi

# set event rule name
event_rule_name=${function_name}-rule

log "debug" "${function}" "query current event rule" "${event_rule_name}"
# get existing event rule
event_rule_name_exist=$(aws events describe-rule \
  --name "${event_rule_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Name" | sed -e 's/^"//' -e 's/"$//')
# check event rule not exist
if [ "${event_rule_name}" != "${event_rule_name_exist}" ]; then
  # set schedule expression
  schedule_expression="cron(*/15 * * * ? *)"
  log "info" "${function}" "create event rule" "${event_rule_name}"
  # create event rule
  aws events put-rule \
    --name "${event_rule_name}" \
    --schedule-expression "${schedule_expression}" \
    --region "${aws_region}" \
    --profile "${aws_profile}"
fi

log "debug" "${function}" "create event rule target" "${event_rule_name}"
# get existing target
target_arn_exist=$(aws events list-targets-by-rule \
  --rule "${event_rule_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Targets[] | select(.Arn==\"${target_arn}\") | .Arn" | sed -e 's/^"//' -e 's/"$//')
# check target not exist on rule
if [ "${target_arn}" != "${target_arn_exist}" ]; then
  log "info" "${function}" "set rule to target" "${event_rule_name} => ${function_name}"
  # set event rule to target
  aws events put-targets \
    --rule "${event_rule_name}" \
    --targets "[{ \"Id\": \"${function_name}\", \"Arn\": \"${target_arn}\" }]" \
    --region "${aws_region}" \
    --profile "${aws_profile}"

  # show next step to user about how to add trigger to function via console
  echo -e "${GREEN}
######################################################################
# Next, open AWS console:
# ${CYAN}https://${aws_region}.console.aws.amazon.com/lambda/#/functions/${function_name}?tab=configure${GREEN}
#
# And Select \"Triggers\" tab
# - Click \"Add trigger\" button
# - Select \"EventBridge (CloudWatch Events)\"
# - Pick an existing rule: \"${event_rule_name}\"
# - Then click \"Add\" button
######################################################################
${NO_COLOR}"
fi

# function
function="historical"
# set function name
function_name="${function_prefix}-${function}-${environment}"
# set compress file name
zip_name="${function_prefix}-${function}.zip"
# go to function directory
cd ${function_dir}/${function}
log "debug" "${function}" "packing" "${zip_name}"
# remove file before pack
rm -f ${function_dir}/${function}/${zip_name}*
# update dependencies & pack function
npm install && rm package-lock.json && zip -r ${zip_name} *

# set timeout, memory size and environment
timeout=900
memory_size=2048
environment_variables="Variables={NODE_NO_WARNINGS=1,ENVIRONMENT=${environment}}"

log "debug" "${function}" "query current function" "${function_name}"
# get existing function
function_name_exist=$(aws lambda get-function \
  --function-name "${function_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Configuration.FunctionName" | sed -e 's/^"//' -e 's/"$//')
# check function exist
if [ "${function_name}" == "${function_name_exist}" ]; then
  log "info" "${function}" "update function" "${function_name}"
  # update function to aws lambda
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --zip-file fileb://${function_dir}/${function}/${zip_name} \
    --region "${aws_region}" \
    --profile "${aws_profile}"
    # --s3-bucket "${aws_bucket}" \
    # --s3-key "${zip_name}" \
  log "info" "${function}" "update function configuration" "${function_name}"
  # update function configuration to aws lambda
  aws lambda update-function-configuration \
    --function-name "${function_name}" \
    --runtime "nodejs14.x" \
    --handler "index.handler" \
    --timeout ${timeout} \
    --memory-size ${memory_size} \
    --environment "${environment_variables}" \
    --region "${aws_region}" \
    --profile "${aws_profile}"
else
  # create execution role for function
  # set role name
  role_name=${function_name}-role-lambda
  log "info" "${function}" "create role for function" "${role_name}"
  # set policy
  policy="{ \"Version\": \"2012-10-17\", \"Statement\": [{ \"Effect\": \"Allow\", \"Principal\": { \"Service\": \"lambda.amazonaws.com\" }, \"Action\": \"sts:AssumeRole\" }] }"
  # create execution role
  role_arn=$(aws iam create-role \
    --role-name "${role_name}" \
    --assume-role-policy-document "${policy}" \
    --profile "${aws_profile}" \
    | jq ".Role.Arn" | sed -e 's/^"//' -e 's/"$//')
  # attach role policy
  aws iam attach-role-policy \
    --role-name "${role_name}" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" \
    --profile "${aws_profile}"
  # wait for role creation
  sleep 5
  log "info" "${function}" "create function" "${function_name}"
  # create function to aws lambda
  aws lambda create-function \
    --function-name "${function_name}" \
    --runtime "nodejs14.x" \
    --handler "index.handler" \
    --role "${role_arn}" \
    --timeout ${timeout} \
    --memory-size ${memory_size} \
    --environment "${environment_variables}" \
    --zip-file fileb://${function_dir}/${function}/${zip_name} \
    --region "${aws_region}" \
    --profile "${aws_profile}"
    # --code "S3Bucket=${aws_bucket},S3Key=${zip_name}" \
fi
# remove file after upload
rm -f ${function_dir}/${function}/${zip_name}*

log "debug" "${function}" "query function arn" "${function_name}"
# get function arn
target_arn=$(aws lambda get-function \
  --function-name "${function_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Configuration.FunctionArn" | sed -e 's/^"//' -e 's/"$//')
# start setup trigger
# set event rule name
event_rule_name=${function_name}-rule

log "debug" "${function}" "query current event rule" "${event_rule_name}"
# get existing event rule
event_rule_name_exist=$(aws events describe-rule \
  --name "${event_rule_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Name" | sed -e 's/^"//' -e 's/"$//')
# check event rule not exist
if [ "${event_rule_name}" != "${event_rule_name_exist}" ]; then
  # set schedule expression
  schedule_expression="cron(*/5 * * * ? *)"
  log "info" "${function}" "create event rule" "${event_rule_name}"
  # create event rule
  aws events put-rule \
    --name "${event_rule_name}" \
    --schedule-expression "${schedule_expression}" \
    --region "${aws_region}" \
    --profile "${aws_profile}"
fi

log "debug" "${function}" "create event rule target" "${event_rule_name}"
# get existing target
target_arn_exist=$(aws events list-targets-by-rule \
  --rule "${event_rule_name}" \
  --region "${aws_region}" \
  --profile "${aws_profile}" \
  | jq ".Targets[] | select(.Arn==\"${target_arn}\") | .Arn" | sed -e 's/^"//' -e 's/"$//')
# check target not exist on rule
if [ "${target_arn}" != "${target_arn_exist}" ]; then
  log "info" "${function}" "set rule to target" "${event_rule_name} => ${function_name}"
  # set event rule to target
  aws events put-targets \
    --rule "${event_rule_name}" \
    --targets "[{ \"Id\": \"${function_name}\", \"Arn\": \"${target_arn}\" }]" \
    --region "${aws_region}" \
    --profile "${aws_profile}"

  # show next step to user about how to add trigger to function via console
  echo -e "${GREEN}
######################################################################
# Next, open AWS console:
# ${CYAN}https://${aws_region}.console.aws.amazon.com/lambda/#/functions/${function_name}?tab=configure${GREEN}
#
# And Select \"Triggers\" tab
# - Click \"Add trigger\" button
# - Select \"EventBridge (CloudWatch Events)\"
# - Pick an existing rule: \"${event_rule_name}\"
# - Then click \"Add\" button
######################################################################
${NO_COLOR}"
fi

log "info" "${function}" "deploy process" "DONE."