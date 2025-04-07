FROM public.ecr.aws/lambda/nodejs:18

COPY package*.json ./
COPY .npmrc ./

RUN npm install

COPY . ./

CMD ["lambdaHandler.handler"]
