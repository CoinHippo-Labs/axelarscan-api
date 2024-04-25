FROM public.ecr.aws/lambda/nodejs:20

COPY --from=public.ecr.aws/datadog/lambda-extension:55 /opt/extensions/ /opt/extensions

COPY . ${LAMBDA_TASK_ROOT}

RUN npm install yarn --global
RUN npm install datadog-lambda-js dd-trace

RUN yarn

CMD [ "index.handler" ]
